import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';

interface BarcodeSvgProps {
  value: string;
  height?: number;
  width?: number;
  displayValue?: boolean;
}

export function BarcodeSvg({
  value,
  height = 46,
  width = 1.6,
  displayValue = true,
}: BarcodeSvgProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!svgRef.current || !value.trim()) return;
    try {
      JsBarcode(svgRef.current, value.trim(), {
        format: 'CODE128',
        lineColor: '#0f172a',
        width,
        height,
        displayValue,
        fontSize: 12,
        margin: 4,
      });
    } catch {
      // Fallback if unsupported char
    }
  }, [value, height, width, displayValue]);

  if (!value.trim()) return null;

  return <svg ref={svgRef} className="max-w-full" />;
}
