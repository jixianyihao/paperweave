// SEA stub: @xenova/transformers imports onnxruntime-web alongside
// onnxruntime-node (src/backends/onnx.js) but only uses it in browser
// environments — in Node it selects ONNX_NODE. Bundling onnxruntime-web
// drags in WASM asset references, so alias it to this empty module.
module.exports = {};
