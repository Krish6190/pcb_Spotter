import React, { useState } from "react";
import "./App.css";

const TILE_SIZE = 640;

function bytesToObjectURL(blob) {
  return URL.createObjectURL(blob);
}

// --- Otsu thresholding utility ---
function otsuThresholdFromGrayHistogram(hist, total) {
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0,
    wB = 0,
    wF = 0,
    varMax = 0,
    threshold = 0;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const varBetween = wB * wF * (mB - mF) * (mB - mF);
    if (varBetween > varMax) {
      varMax = varBetween;
      threshold = t;
    }
  }
  return threshold;
}

// --- Convert bitmap to PNG blob with optional thresholding ---
async function bitmapToTileBlob(bitmap, applyThreshold = false) {
  const canvas = document.createElement("canvas");
  canvas.width = TILE_SIZE;
  canvas.height = TILE_SIZE;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0);

  if (!applyThreshold) {
    return await new Promise((res) => canvas.toBlob(res, "image/png"));
  }

  const imgData = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE);
  const data = imgData.data;
  const hist = new Array(256).fill(0);
  const total = TILE_SIZE * TILE_SIZE;

  for (let i = 0; i < data.length; i += 4) {
    const lum = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    hist[lum]++;
  }

  const thresh = otsuThresholdFromGrayHistogram(hist, total);

  for (let i = 0; i < data.length; i += 4) {
    const lum = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    const v = lum >= thresh ? 255 : 0;
    data[i] = data[i + 1] = data[i + 2] = v;
  }

  ctx.putImageData(imgData, 0, 0);
  return await new Promise((res) => canvas.toBlob(res, "image/png"));
}

// --- Compute tile grid positions like DeepPCB ---
function computeCoords(length, tileSize) {
  const count = Math.ceil(length / tileSize);
  const coords = [];
  if (count === 1) return [0];
  for (let i = 0; i < count; i++) {
    coords.push(Math.round((i * (length - tileSize)) / (count - 1)));
  }
  return coords;
}

// --- Split a large bitmap into aligned 640x640 tiles ---
async function splitBitmap(bitmap) {
  const colsCoords = computeCoords(bitmap.width, TILE_SIZE);
  const rowsCoords = computeCoords(bitmap.height, TILE_SIZE);
  const tiles = [];

  const tmpCanvas = document.createElement("canvas");
  tmpCanvas.width = TILE_SIZE;
  tmpCanvas.height = TILE_SIZE;
  const tmpCtx = tmpCanvas.getContext("2d");

  for (let y of rowsCoords) {
    for (let x of colsCoords) {
      tmpCtx.clearRect(0, 0, TILE_SIZE, TILE_SIZE);
      tmpCtx.drawImage(bitmap, x, y, TILE_SIZE, TILE_SIZE, 0, 0, TILE_SIZE, TILE_SIZE);
      const tileBitmap = await createImageBitmap(tmpCanvas);
      tiles.push({ bitmap: tileBitmap, x, y });
    }
  }
  return { tiles, colsCoords, rowsCoords };
}

function App() {
  const [file, setFile] = useState(null);
  const [applyThreshold, setApplyThreshold] = useState(true);
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    setFile(e.target.files?.[0] || null);
    setResult(null);
  };

  const handleProcess = async () => {
    if (!file) {
      setStatus("Please upload an image first.");
      return;
    }

    setLoading(true);
    setStatus("Preparing...");
    setProgress({ done: 0, total: 0 });
    setResult(null);

    try {
      const bitmap = await createImageBitmap(file);
      const { tiles, colsCoords, rowsCoords } = await splitBitmap(bitmap);

      const totalTiles = tiles.length;
      setProgress({ done: 0, total: totalTiles });

      const processed = [];

      for (let i = 0; i < tiles.length; i++) {
        const t = tiles[i];
        setStatus(`Processing tile ${i + 1} / ${totalTiles}...`);

        const tileBlob = await bitmapToTileBlob(t.bitmap, applyThreshold);

        const form = new FormData();
        form.append("image", tileBlob, `tile_${i}.png`);

        const resp = await fetch("http://127.0.0.1:5000/detect", {
          method: "POST",
          body: form,
        });

        if (!resp.ok) throw new Error(`Server error: ${resp.status}`);

        const blob = await resp.blob();
        const resultBitmap = await createImageBitmap(blob);
        processed.push({ bitmap: resultBitmap, x: t.x, y: t.y });

        setProgress((p) => ({ done: p.done + 1, total: totalTiles }));
      }

      setStatus("Reassembling...");

      const finalCanvas = document.createElement("canvas");
      finalCanvas.width = bitmap.width;
      finalCanvas.height = bitmap.height;
      const ctx = finalCanvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);

      for (const t of processed) {
        ctx.drawImage(t.bitmap, t.x, t.y, TILE_SIZE, TILE_SIZE);
      }

      const finalBlob = await new Promise((r) => finalCanvas.toBlob(r, "image/png"));
      setResult(bytesToObjectURL(finalBlob));

      setStatus("Done!");
    } catch (err) {
      console.error(err);
      setStatus("Error: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <h1>PCB Fault Detector</h1>
      <p>Upload a faulty PCB image. The app will split it, analyze it, and merge the results.</p>

      <input type="file" accept="image/*" onChange={handleChange} />
      <div>
        <label>
          <input
            type="checkbox"
            checked={applyThreshold}
            onChange={(e) => setApplyThreshold(e.target.checked)}
          />{" "}
          Apply Otsu thresholding before sending
        </label>
      </div>

      <button onClick={handleProcess} disabled={loading}>
        {loading ? "Processing..." : "Upload & Detect"}
      </button>

      {status && <p className="status">{status}</p>}
      {progress.total > 0 && (
        <p className="status">
          {progress.done}/{progress.total} tiles processed
        </p>
      )}

      {file && (
        <div className="preview">
          <h3>Uploaded Image</h3>
          <img src={URL.createObjectURL(file)} alt="preview" />
        </div>
      )}

      {result && (
        <div className="result">
          <h3>Result</h3>
          <img src={result} alt="result" />
          <div>
            <a href={result} download="result.png">
              Download Result
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
