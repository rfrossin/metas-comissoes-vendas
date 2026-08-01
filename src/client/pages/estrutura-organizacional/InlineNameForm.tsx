import { useState, type FormEvent } from "react";

interface InlineNameFormProps {
  initialValue?: string;
  placeholder: string;
  submitLabel: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
  isSubmitting?: boolean;
}

export function InlineNameForm({
  initialValue = "",
  placeholder,
  submitLabel,
  onSubmit,
  onCancel,
  isSubmitting,
}: InlineNameFormProps) {
  const [name, setName] = useState(initialValue);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (!name.trim()) {
      return;
    }

    onSubmit(name.trim());
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <input
        autoFocus
        value={name}
        placeholder={placeholder}
        onChange={(event) => setName(event.target.value)}
        className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
      />
      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
      >
        {submitLabel}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded-md border border-border px-3 py-1 text-xs text-muted-foreground"
      >
        Cancelar
      </button>
    </form>
  );
}
