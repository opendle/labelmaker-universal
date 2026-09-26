import { Check, Square } from "lucide-react";
import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

export function CodeToggle({
  label,
  checked,
  onChange,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={checked}
      className={`image-background-toggle code-toggle${checked ? " active" : ""}`}
      onClick={() => onChange(!checked)}
    >
      {checked ? (
        <Check size={16} aria-hidden="true" />
      ) : (
        <Square size={16} aria-hidden="true" />
      )}
      {label}
    </button>
  );
}

export function CodeTextarea(
  props: TextareaHTMLAttributes<HTMLTextAreaElement>,
) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const field = ref.current;
    if (!field) return;
    const resize = () => {
      field.style.height = "0px";
      field.style.height = `${field.scrollHeight + 2}px`;
    };
    resize();
    if (typeof ResizeObserver === "undefined") return;
    let width = field.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const nextWidth = field.getBoundingClientRect().width;
      if (width === nextWidth) return;
      width = nextWidth;
      resize();
    });
    observer.observe(field);
    return () => observer.disconnect();
  }, [props.value]);
  return <textarea {...props} ref={ref} />;
}
