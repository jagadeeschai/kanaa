// Golden-frame test, part 2. Paste into the browser console with the Golden frames project open. Needs the dev server.
(async () => {
  const data = await (await fetch('/golden.json')).json();
  const [w, h] = data.grid;
  const canvas = document.querySelector('.ed-frame canvas');
  const full = document.createElement('canvas'); full.width = canvas.width; full.height = canvas.height;
  const context = full.getContext('2d', { willReadFrequently: true });
  const block = canvas.width / w;
  const results = [];
  for (const sample of data.samples) {
    window.motionEngine.seek(sample.t);
    await new Promise((resolve) => setTimeout(resolve, 30));
    window.motionEngine.draw(); // Not requestAnimationFrame: a hidden pane updates about once a second.
    context.drawImage(canvas, 0, 0);
    const seen = context.getImageData(0, 0, full.width, full.height).data;
    const grid = new Float64Array(w * h * 3);
    for (let y = 0; y < full.height; y += 1) for (let x = 0; x < full.width; x += 1) {
      const cell = (Math.floor(y / block) * w + Math.floor(x / block)) * 3; const at = (y * full.width + x) * 4;
      for (let c = 0; c < 3; c += 1) grid[cell + c] += seen[at + c] / (block * block);
    }
    let total = 0; let worst = 0;
    for (let i = 0; i < grid.length; i += 1) {
      const gap = Math.abs(grid[i] - parseInt(sample.pixels.substr(i * 2, 2), 16));
      total += gap; worst = Math.max(worst, gap);
    }
    results.push({ name: sample.name, mean: +(total / grid.length).toFixed(2), worst: Math.round(worst) });
  }
  return results;
})();
