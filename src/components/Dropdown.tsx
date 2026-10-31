import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export interface DropdownOption {
  value: string;
  label: string;
  count?: number;
}

interface DropdownProps {
  label: string;
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
}

/**
 * The native picker is the one surface a page cannot style: on Windows it drops
 * a grey rectangle with a blue selection over the artwork. This is the same
 * list, drawn in the site's own colours, with the counts that make the filters
 * worth opening.
 */
export default function Dropdown({ label, value, options, onChange }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [open]);

  function onListKey(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (!step && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const nodes = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'));
    if (!nodes.length) return;
    const current = nodes.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? nodes.length - 1
          : Math.min(nodes.length - 1, Math.max(0, current + step));
    nodes[next]?.focus();
  }

  return (
    <div className="mf-select" ref={wrapRef} data-open={open ? "true" : undefined}>
      <span className="mf-select__label">{label}</span>
      <button
        type="button"
        className="mf-select__value"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`${label} : ${selected?.label ?? ""}`}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            if (event.key === "ArrowDown") event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {selected?.label ?? "—"}
        <ChevronDown size={13} className="mf-select__chev" aria-hidden="true" />
      </button>

      {open ? (
        <div
          className="mf-menu"
          id={listId}
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          onKeyDown={onListKey}
        >
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                ref={active ? activeRef : undefined}
                type="button"
                role="option"
                aria-selected={active}
                className={`mf-menu__item${active ? " is-active" : ""}`}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <span className="mf-menu__label">{option.label}</span>
                {typeof option.count === "number" ? (
                  <span className="mf-menu__count">{option.count.toLocaleString("fr-FR")}</span>
                ) : null}
                {active ? <Check size={13} className="mf-menu__check" aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
