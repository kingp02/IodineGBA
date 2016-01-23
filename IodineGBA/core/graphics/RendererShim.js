"use strict";
/*
 Copyright (C) 2012-2016 Grant Galitz

 Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

 The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
 function getGameBoyAdvanceGraphicsRenderer(coreExposed, skippingBIOS) {
     //if (!window.SharedArrayBuffer || !Atomics) {
         return new GameBoyAdvanceGraphicsRenderer(coreExposed, skippingBIOS);
     /*}
     else {
         return new GameBoyAdvanceGraphicsRendererShim(coreExposed, skippingBIOS);
     }*/
 }
 function GameBoyAdvanceGraphicsRendererShim(coreExposed, skippingBIOS) {
     this.coreExposed = coreExposed;
     this.initializeWorker();
     this.initializeBuffers();
     this.shareBuffers(skippingBIOS);
 }
 GameBoyAdvanceGraphicsRendererShim.prototype.initializeWorker = function () {
     this.worker = new Worker("RendererShimWorker.js");
 }
 GameBoyAdvanceGraphicsRendererShim.prototype.initializeBuffers = function () {
     //Graphics Buffers:
     this.gfxCommandBuffer = getSharedInt32Array(0x80000);
     this.gfxCommandCounters = getSharedInt32Array(2);
     this.start = 0;
     this.end = 0;
 }
 GameBoyAdvanceGraphicsRendererShim.prototype.appendAtomicSync = function () {
     //Command buffer counters get synchronized with emulator runtime head/end for efficiency:
     var parentObj = this;
     this.coreExposed.appendStartIterationSync(function () {
         //Load command buffer reader counter value:
         parentObj.start = Atomics.load(parentObj.gfxCommandCounters, 0) | 0;
     });
     this.coreExposed.appendEndIterationSync(function () {
         //Store command buffer writer counter value:
         Atomics.store(parentObj.gfxCommandCounters, 1, parentObj.end | 0);
         //Tell consumer thread to check command buffer:
         this.worker.postMessage({messageID:0});
     });
     this.coreExposed.appendTerminationSync(function () {
         //Core instance being replaced, kill the worker thread:
         this.worker.terminate();
     });
 }
 GameBoyAdvanceGraphicsRendererShim.prototype.shareBuffers = function (skippingBIOS) {
     skippingBIOS = !!skippingBIOS;
     this.worker.postMessage({
         messageID:1,
         skippingBIOS:!!skippingBIOS,
         gfxBuffers:gfxBuffers,
         gfxCounters:gfxCounters,
         gfxCommandBuffer:this.gfxCommandBuffer,
         gfxCommandCounters:this.gfxCommandCounters
     }, [
         gfxBuffers[0].buffer,
         gfxBuffers[1].buffer,
         gfxCounters.buffer,
         this.gfxCommandBuffer.buffer,
         this.gfxCommandCounters.buffer
     ]);
 }
GameBoyAdvanceGraphicsRendererShim.prototype.pushCommand = function (command, data) {
    command = command | 0;
    data = data | 0;
    //Block while full:
    this.blockIfCommandBufferFull();
    //Get the write offset into the ring buffer:
    var endCorrected = this.end & 0x7FFFF;
    //Push command into buffer:
    this.gfxCommandBuffer[endCorrected | 0] = command | 0;
    //Push data into buffer:
    this.gfxCommandBuffer[endCorrected | 1] = data | 0;
    //Update the cross thread buffering count:
    this.end = ((this.end | 0) + 2) | 0;
}
GameBoyAdvanceGraphicsRendererShim.prototype.blockIfCommandBufferFull = function () {
    if ((this.start | 0) == (((this.end | 0) - 0x80000) | 0)) {
        //Wait for consumer thread:
        Atomics.futexWait(this.gfxCommandCounters, 0, ((this.end | 0) - 0x80000) | 0);
        //Reload reader counter value:
        this.start = Atomics.load(this.gfxCommandCounters, 0) | 0;
    }
}
GameBoyAdvanceGraphicsRendererShim.prototype.incrementScanLineQueue = function () {
    //Increment scan line command:
    this.pushCommand(0, 0);
}
GameBoyAdvanceGraphicsRendererShim.prototype.ensureFraming = function () {
    //Vertical blank synchronization command:
    this.pushCommand(0, 1);
}
