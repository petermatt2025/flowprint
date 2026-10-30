// Python sandbox (Pyodide) running in a Web Worker, fully offline inside the extension.
let pyReady = null;
function boot() {
  if (!pyReady) {
    pyReady = (async () => {
      const { loadPyodide } = await import("../lib/pyodide/pyodide.mjs");
      return loadPyodide({ indexURL: new URL("../lib/pyodide/", self.location.href).href });
    })();
  }
  return pyReady;
}

self.onmessage = async e => {
  const { id, code, files } = e.data;
  let out = "";
  try {
    const py = await boot();
    py.setStdout({ batched: s => { out += `${s}\n`; } });
    py.setStderr({ batched: s => { out += `${s}\n`; } });
    try { py.FS.mkdir("/data"); } catch { /* exists */ }
    for (const f of files || []) py.FS.writeFile(`/data/${f.name}`, f.text);
    const result = await py.runPythonAsync(code);
    const shown = result === undefined || result === null ? "" : String(result?.toString ? result.toString() : result);
    self.postMessage({ id, ok: true, output: out, result: shown });
  } catch (err) {
    self.postMessage({ id, ok: false, output: out, error: String(err.message || err) });
  }
};
