import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Pencil, UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { describeError } from "@/api/client";
import { type UserInput, manageApi } from "@/api/manageApi";
import { ErrorBlock, LoadingBlock } from "@/components/common/States";
import { Pill } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ManagedUser, Role } from "@/types/domain";
import { ROLE_LABELS } from "@/utils/constants";
import { relativeTime } from "@/utils/formatting";

import { Field, NativeSelect } from "./shared";

const ROLE_HELP: Record<Role, string> = {
  admin: "Everything, including users and settings",
  manager: "Stock, catalogue, suppliers, approvals, reports",
  pharmacist: "Dispense, receive stock, approve reorders, reports",
  staff: "View stock and check expiry only",
};

/** Admin-only: add staff, set their role, reset passwords, deactivate leavers. */
export function UsersPanel({ currentUserEmail }: { currentUserEmail?: string | undefined }) {
  const users = useQuery({ queryKey: ["users"], queryFn: manageApi.users });
  const [editing, setEditing] = useState<ManagedUser | "new" | null>(null);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">Users and roles</CardTitle>
          <CardDescription>
            Deactivate leavers instead of deleting them, so their actions stay in the audit trail.
          </CardDescription>
        </div>
        <Button onClick={() => setEditing("new")}>
          <UserPlus className="h-4 w-4" /> Add user
        </Button>
      </CardHeader>
      <CardContent>
        {users.isPending ? (
          <LoadingBlock rows={5} label="Loading users" />
        ) : users.isError ? (
          <ErrorBlock error={users.error} onRetry={() => users.refetch()} />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Last sign-in</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(users.data ?? []).map((u) => (
                  <TableRow key={u.id} className={u.active ? undefined : "opacity-60"}>
                    <TableCell className="font-medium">
                      {u.name}
                      {u.email === currentUserEmail ? <span className="ml-2 text-xs text-muted-foreground">(you)</span> : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{u.email}</TableCell>
                    <TableCell>{ROLE_LABELS[u.role]}</TableCell>
                    <TableCell className="text-muted-foreground">{u.lastLogin ? relativeTime(u.lastLogin) : "Never"}</TableCell>
                    <TableCell>{u.active ? <Pill tone="success">Active</Pill> : <Pill>Deactivated</Pill>}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(u)} aria-label={`Edit ${u.name}`}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      {editing ? <UserDialog user={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
    </Card>
  );
}

function UserDialog({ user, onClose }: { user: ManagedUser | null; onClose: () => void }) {
  const client = useQueryClient();
  const [form, setForm] = useState({
    email: user?.email ?? "",
    firstName: user?.firstName ?? "",
    lastName: user?.lastName ?? "",
    role: user?.role ?? ("pharmacist" as Role),
    active: user?.active ?? true,
    password: "",
  });

  const save = useMutation({
    mutationFn: () => {
      const body: Partial<UserInput> = {
        email: form.email,
        firstName: form.firstName,
        lastName: form.lastName,
        role: form.role,
        active: form.active,
      };
      if (form.password) body.password = form.password;
      return user ? manageApi.updateUser(user.id, body) : manageApi.createUser(body as UserInput);
    },
    onSuccess: async (u) => {
      toast.success(user ? `Saved ${u.name}` : `Added ${u.name}`, {
        description: user ? undefined : `They can sign in now as ${u.email}.`,
      });
      onClose();
      await client.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (error) => toast.error(describeError(error).title, { description: describeError(error).detail }),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>{user ? `Edit ${user.name}` : "Add a user"}</DialogTitle>
            <DialogDescription>Use the person's work email; it is their sign-in name.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" htmlFor="usr-first">
              <Input id="usr-first" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required />
            </Field>
            <Field label="Last name" htmlFor="usr-last">
              <Input id="usr-last" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
            </Field>
            <Field label="Work email" htmlFor="usr-email" className="sm:col-span-2">
              <Input id="usr-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            </Field>
            <Field label="Role" htmlFor="usr-role" hint={ROLE_HELP[form.role]} className="sm:col-span-2">
              <NativeSelect id="usr-role" value={form.role} onChange={(v) => setForm({ ...form, role: v as Role })}>
                {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field
              label={user ? "New password (leave blank to keep)" : "First password"}
              htmlFor="usr-password"
              hint="At least 8 characters; not a common or all-number password."
              className="sm:col-span-2"
            >
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden />
                <Input
                  id="usr-password"
                  type="password"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  required={!user}
                  minLength={8}
                />
              </div>
            </Field>
            {user ? (
              <div className="flex items-center gap-3 sm:col-span-2">
                <Switch id="usr-active" checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
                <label htmlFor="usr-active" className="text-sm">
                  Active — a deactivated user cannot sign in
                </label>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving…" : user ? "Save changes" : "Add user"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
