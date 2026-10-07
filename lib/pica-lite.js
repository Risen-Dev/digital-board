/**
 * Drop-in for `pica`, aliased in next.config.ts for the browser.
 *
 * Excalidraw shrinks inserted images through pica, which refuses to run
 * when the browser's fingerprinting protection (Safari, Brave, Firefox RFP)
 * noises getImageData — the image then skips resizing and trips the 4MB cap.
 * drawImage + toBlob never reads pixels back, so it works everywhere.
 */
module.exports = function pica() {
  return {
    options: {
      createCanvas(width, height) {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        return canvas;
      },
    },
    init: () => Promise.resolve(),
    resize(from, to) {
      const ctx = to.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(from, 0, 0, to.width, to.height);
      return Promise.resolve(to);
    },
    toBlob: (canvas, type, quality) =>
      new Promise((resolve) => canvas.toBlob(resolve, type, quality)),
  };
};
