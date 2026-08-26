import { X } from "lucide-react";

export function Btn({
  children,
  onClick,
  disabled,
  variant = "primary",
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost" | "outline";
  type?: "button" | "submit";
}) {
  const base =
    "flex w-full items-center justify-center gap-2 rounded-2xl py-[14px] text-[15px] font-semibold transition-all duration-150 active:scale-[0.98]";
  const variants = {
    primary: "bg-primary text-primary-foreground hover:bg-primary-hover disabled:opacity-35",
    ghost: "bg-secondary text-foreground hover:bg-border",
    outline: "border border-primary text-primary hover:bg-accent",
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${variants[variant]}`}>
      {children}
    </button>
  );
}

export function FlowHeader({
  label,
  icon,
  onClose,
}: {
  label: string;
  icon: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-1 pb-6">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-[13px] font-medium">{label}</span>
      </div>
      <button
        onClick={onClose}
        className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-muted-foreground transition-colors hover:bg-border"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function OptionButton({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full rounded-2xl border px-4 py-4 text-left text-[15px] transition-all duration-150 active:scale-[0.99] ${
        selected
          ? "border-primary bg-accent text-foreground"
          : "border-border bg-card text-foreground hover:border-disabled"
      }`}
    >
      {label}
    </button>
  );
}

export function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center text-muted-foreground">
      {children}
    </main>
  );
}
