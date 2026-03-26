import { useEffect, useRef, useState } from "react";
import type { PlanData } from "../../types";
import type { PlanSegmentation } from "./types";

interface SegmentMapPanelProps {
  plan: PlanData | null;
  segmentation: PlanSegmentation | null;
}

function colorFor(index: number, alpha: number): string {
  const hue = (index * 57) % 360;
  return `hsla(${hue} 72% 48% / ${alpha})`;
}

export function SegmentMapPanel({ plan, segmentation }: SegmentMapPanelProps) {
  const [backgroundUrl, setBackgroundUrl] = useState("");
  const [selectedLabel, setSelectedLabel] = useState("");
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!segmentation) {
      setSelectedLabel("");
      return;
    }
    setSelectedLabel((current) => {
      if (current && segmentation.labels.includes(current)) {
        return current;
      }
      return segmentation.segments[0]?.label || "";
    });
  }, [segmentation]);

  useEffect(() => {
    if (!plan?.previewUrl) {
      setBackgroundUrl("");
      return;
    }

    let isActive = true;
    const image = new Image();
    image.onload = () => {
      if (isActive) {
        setBackgroundUrl(plan.previewUrl);
      }
    };
    image.onerror = () => {
      if (isActive) {
        setBackgroundUrl("");
      }
    };
    image.src = plan.previewUrl;

    return () => {
      isActive = false;
    };
  }, [plan?.previewUrl]);

  useEffect(() => {
    if (!segmentation || !stageRef.current || !canvasRef.current) {
      return;
    }

    const stage = stageRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    const currentSegmentation = segmentation;

    if (!context) {
      return;
    }

    const drawingContext = context;

    function drawOverlay() {
      const width = stage.clientWidth;
      const height = stage.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      drawingContext.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawingContext.clearRect(0, 0, width, height);

      const cellWidth = width / currentSegmentation.gridWidth;
      const cellHeight = height / currentSegmentation.gridHeight;

      for (let gy = 0; gy < currentSegmentation.gridHeight; gy += 1) {
        for (let gx = 0; gx < currentSegmentation.gridWidth; gx += 1) {
          const index = gy * currentSegmentation.gridWidth + gx;
          const labelIndex = currentSegmentation.grid[index];
          const label = currentSegmentation.labels[labelIndex];
          const isSelected = !selectedLabel || label === selectedLabel;
          drawingContext.fillStyle = colorFor(labelIndex, isSelected ? 0.18 : 0.045);
          drawingContext.fillRect(gx * cellWidth, gy * cellHeight, cellWidth + 1, cellHeight + 1);
        }
      }

      drawingContext.lineWidth = 1;
      for (let gy = 0; gy < currentSegmentation.gridHeight; gy += 1) {
        for (let gx = 0; gx < currentSegmentation.gridWidth; gx += 1) {
          const index = gy * currentSegmentation.gridWidth + gx;
          const current = currentSegmentation.grid[index];

          if (gx < currentSegmentation.gridWidth - 1) {
            const right = currentSegmentation.grid[index + 1];
            if (current !== right) {
              const selectedBoundary =
                !selectedLabel ||
                currentSegmentation.labels[current] === selectedLabel ||
                currentSegmentation.labels[right] === selectedLabel;
              drawingContext.strokeStyle = selectedBoundary ? "rgba(17,32,51,0.45)" : "rgba(17,32,51,0.12)";
              drawingContext.beginPath();
              drawingContext.moveTo((gx + 1) * cellWidth, gy * cellHeight);
              drawingContext.lineTo((gx + 1) * cellWidth, (gy + 1) * cellHeight);
              drawingContext.stroke();
            }
          }

          if (gy < currentSegmentation.gridHeight - 1) {
            const down = currentSegmentation.grid[index + currentSegmentation.gridWidth];
            if (current !== down) {
              const selectedBoundary =
                !selectedLabel ||
                currentSegmentation.labels[current] === selectedLabel ||
                currentSegmentation.labels[down] === selectedLabel;
              drawingContext.strokeStyle = selectedBoundary ? "rgba(17,32,51,0.45)" : "rgba(17,32,51,0.12)";
              drawingContext.beginPath();
              drawingContext.moveTo(gx * cellWidth, (gy + 1) * cellHeight);
              drawingContext.lineTo((gx + 1) * cellWidth, (gy + 1) * cellHeight);
              drawingContext.stroke();
            }
          }
        }
      }

      currentSegmentation.points.forEach((point) => {
        const labelIndex = currentSegmentation.labels.indexOf(point.segmentLabel);
        const isSelected = !selectedLabel || point.segmentLabel === selectedLabel;
        const x = (point.x / currentSegmentation.width) * width;
        const y = (point.y / currentSegmentation.height) * height;
        drawingContext.fillStyle = colorFor(labelIndex, isSelected ? 0.95 : 0.35);
        drawingContext.beginPath();
        drawingContext.arc(x, y, isSelected ? 4.5 : 3, 0, Math.PI * 2);
        drawingContext.fill();
      });
    }

    drawOverlay();
    const observer = new ResizeObserver(drawOverlay);
    observer.observe(stage);

    return () => observer.disconnect();
  }, [segmentation, selectedLabel]);

  if (!plan || !segmentation) {
    return null;
  }

  return (
    <section className="segmentation-panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Segmentacion</p>
          <h2>Plano por switch</h2>
        </div>
        <div className="insights-meta">
          <span>{segmentation.totals.physicalSwitches} switches fisicos</span>
          <span>{segmentation.totals.segments} segmentos</span>
          <span>{segmentation.totals.segmentedPoints} puntos segmentados</span>
        </div>
      </div>

      <div className="segmentation-summary">
        <article className="snapshot-card">
          <span>Segmentos</span>
          <strong>{segmentation.totals.segments}</strong>
        </article>
        <article className="snapshot-card">
          <span>Switches fisicos</span>
          <strong>{segmentation.totals.physicalSwitches}</strong>
        </article>
        <article className="snapshot-card">
          <span>Familia S-GM</span>
          <strong>{segmentation.totals.gmMemberSwitches}</strong>
        </article>
        <article className="snapshot-card">
          <span>Puntos con switch</span>
          <strong>{segmentation.totals.segmentedPoints}</strong>
        </article>
      </div>

      <p className="segmentation-note">
        `S-GM-2`, `S-GM-3` y similares se muestran como un solo segmento `S-GM`, pero se
        conservan como switches fisicos dentro del detalle.
      </p>

      <div className="segmentation-layout">
        <div className="segmentation-list">
          {segmentation.segments.map((segment) => (
            <button
              key={segment.label}
              type="button"
              className={`segment-chip-card ${selectedLabel === segment.label ? "segment-chip-card--active" : ""}`}
              onClick={() => setSelectedLabel(segment.label)}
            >
              <div className="segment-chip-card__top">
                <span
                  className="segment-chip-card__swatch"
                  style={{ background: colorFor(segmentation.labels.indexOf(segment.label), 0.85) }}
                />
                <strong>{segment.label}</strong>
              </div>
              <span>{segment.deviceCount} dispositivos</span>
              <span>{segment.switches.join(" · ") || "Sin switches"}</span>
            </button>
          ))}
        </div>

        <div
          ref={stageRef}
          className="segmentation-stage"
          style={{ aspectRatio: `${plan.width} / ${plan.height}` }}
        >
          {backgroundUrl && <img src={backgroundUrl} alt="Plano base para segmentacion" className="segmentation-stage__image" />}
          <canvas ref={canvasRef} className="segmentation-stage__overlay" />
        </div>
      </div>
    </section>
  );
}
