const Tesseract = require('tesseract.js');
async function test() {
  try {
    const worker = await Tesseract.createWorker("eng", 1, {
      logger: m => console.log(m.status)
    });
    console.log("Worker created with options");
    await worker.terminate();
  } catch (e) {
    console.error(e);
  }
}
test();
