import { type ReactNode, useState } from "react";

import { Pill } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { BatchStatus } from "@/types/domain";

import { BATCH_STATUS } from "./stockMeta";

export function BatchStatusPill({ status }: { status: BatchStatus }) {
  const meta = BATCH_STATUS[status];
  const Icon = meta.icon;
  return (
    <Pill tone={meta.tone}>
      <Icon className="h-3 w-3" aria-hidden />
      {meta.label}
    </Pill>
  );
}

/** Labelled form control. */
export function Field({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  hint?: string | undefined;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** A plain <select> styled like the inputs: reliable inside dialogs and easy to test. */
export function NativeSelect({
  id,
  value,
  onChange,
  children,
  disabled,
  required,
  ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
  required?: boolean;
  ariaLabel?: string;
}) {
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      required={required}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value)}
      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
    >
      {children}
    </select>
  );
}

/** Confirm an action that needs a reason for the audit trail. */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  pending,
  extra,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  pending?: boolean;
  extra?: ReactNode;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setReason("");
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            onConfirm(reason.trim());
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {extra}
          <Field label="Reason (kept in the audit trail)" htmlFor="reason">
            <Input
              id="reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. Expired on shelf check, MCAZ recall notice"
              required
              autoFocus
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={!reason.trim() || pending}>
              {pending ? "Saving…" : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
