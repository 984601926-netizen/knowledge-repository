import { useEffect, useRef, useState } from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import worker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  LoaderCircle,
} from "lucide-react";
GlobalWorkerOptions.workerSrc = worker;
export default function PdfReader({
  asset,
  hitPage,
}: {
  asset: string;
  hitPage?: number | null;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    [pdf, setPdf] = useState<PDFDocumentProxy | null>(null),
    [page, setPage] = useState(hitPage || 1),
    [zoom, setZoom] = useState(1.1),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(true);
  useEffect(() => {
    setError("");
    setPdf(null);
    setBusy(true);
    let disposed = false;
    let task: ReturnType<typeof getDocument> | undefined;
    // Local bytes cross the narrow preload bridge; PDF.js never needs a network URL.
    window.knowledge
      .call<Uint8Array>("asset-bytes", { asset })
      .then((bytes) => {
        if (disposed) return;
        const support = import.meta.env.DEV
          ? new URL("/node_modules/pdfjs-dist/", location.href).href
          : new URL("./pdf-support/", document.baseURI).href;
        task = getDocument({
          data: new Uint8Array(bytes),
          useSystemFonts: true,
          cMapUrl: support + "cmaps/",
          cMapPacked: true,
          standardFontDataUrl: support + "standard_fonts/",
          wasmUrl: support + "wasm/",
        });
        return task.promise;
      })
      .then((document) => {
        if (!disposed && document) {
          setPdf(document);
          setPage(Math.min(hitPage || 1, document.numPages));
        }
      })
      .catch((e) => {
        if (!disposed) {
          setError(e.message);
          setBusy(false);
        }
      });
    return () => {
      disposed = true;
      void task?.destroy();
    };
  }, [asset]);
  useEffect(() => {
    if (pdf && hitPage) setPage(Math.min(hitPage, pdf.numPages));
  }, [hitPage, pdf]);
  useEffect(() => {
    if (!pdf || !canvas.current) return;
    let stopped = false,
      rendering:
        | ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]>
        | undefined;
    setBusy(true);
    pdf
      .getPage(page)
      .then((p) => {
        if (stopped || !canvas.current) return;
        const viewport = p.getViewport({ scale: zoom }),
          ratio = Math.min(devicePixelRatio || 1, 2),
          element = canvas.current;
        element.width = Math.floor(viewport.width * ratio);
        element.height = Math.floor(viewport.height * ratio);
        element.style.width = viewport.width + "px";
        element.style.height = viewport.height + "px";
        rendering = p.render({
          canvas: element,
          viewport,
          transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
        });
        return rendering.promise;
      })
      .then(() => {
        if (!stopped) setBusy(false);
      })
      .catch((e) => {
        if (!stopped && e.name !== "RenderingCancelledException") {
          setError(e.message);
          setBusy(false);
        }
      });
    return () => {
      stopped = true;
      rendering?.cancel();
    };
  }, [pdf, page, zoom]);
  return (
    <section className="pdf-reader" aria-label="PDF 阅读器">
      <div className="pdf-tools">
        <button
          title="上一页"
          disabled={!pdf || page <= 1}
          onClick={() => setPage((p) => p - 1)}
        >
          <ChevronLeft size={17} />
        </button>
        <label>
          第{" "}
          <input
            aria-label="PDF 页码"
            type="number"
            min={1}
            max={pdf?.numPages || 1}
            value={page}
            onChange={(e) => {
              const value = Number(e.target.value);
              if (pdf && value >= 1 && value <= pdf.numPages) setPage(value);
            }}
          />{" "}
          / {pdf?.numPages || "…"} 页
        </label>
        <button
          title="下一页"
          disabled={!pdf || page >= pdf.numPages}
          onClick={() => setPage((p) => p + 1)}
        >
          <ChevronRight size={17} />
        </button>
        <span className="tool-divider" />
        <button
          title="缩小"
          disabled={zoom <= 0.4}
          onClick={() => setZoom((z) => Math.max(0.4, z - 0.1))}
        >
          <Minus size={16} />
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button
          title="放大"
          disabled={zoom >= 2.5}
          onClick={() => setZoom((z) => Math.min(2.5, z + 0.1))}
        >
          <Plus size={16} />
        </button>
        {busy && <LoaderCircle size={16} className="spin" />}
      </div>
      <div className="pdf-canvas-area">
        {error ? (
          <div className="inline-error">
            无法预览 PDF：{error}
            <p>加密、损坏或不受支持的文件可能无法打开。</p>
          </div>
        ) : (
          <canvas ref={canvas} />
        )}
      </div>
    </section>
  );
}
