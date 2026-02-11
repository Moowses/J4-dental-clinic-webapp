"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useActionState } from "react";

import { useAuth } from "@/lib/hooks/useAuth";
import {
  createEmployeeAction,
  searchUsersByTermAction,
  sendUserPasswordResetByEmailAction,
} from "@/app/actions/admin-actions";

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100">
        <h3 className="text-lg font-extrabold text-slate-900">{title}</h3>
        {subtitle ? <p className="text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

const inputBase =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-300";

type DirectoryUser = {
  uid: string;
  email: string;
  displayName: string;
  role: string;
  emailVerified: boolean;
};

export default function StaffHRPanel() {
  const { user } = useAuth();
  const [token, setToken] = useState("");

  const [state, formAction, isPending] = useActionState(createEmployeeAction, {
    success: false,
  });

  const [query, setQuery] = useState("");
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [searchError, setSearchError] = useState("");
  const [sendingUid, setSendingUid] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!user) return;
    user.getIdToken().then(setToken);
  }, [user]);

  const runSearch = useCallback(async (term: string) => {
    if (!token) return;
    setLoadingUsers(true);
    setSearchError("");
    setNotice("");
    try {
      const res = await searchUsersByTermAction({ idToken: token, term });
      if (!res?.success) {
        setSearchError(res?.error || "Failed to search users.");
        setUsers([]);
        return;
      }
      setUsers((res.data || []) as DirectoryUser[]);
    } finally {
      setLoadingUsers(false);
    }
  }, [token]);

  const handleSendReset = async (u: DirectoryUser) => {
    if (!token || !u.email) return;
    const ok =
      typeof window === "undefined"
        ? true
        : window.confirm(`Send reset password email to ${u.email}?`);
    if (!ok) return;

    setSendingUid(u.uid);
    setNotice("");
    setSearchError("");
    try {
      const res = await sendUserPasswordResetByEmailAction({
        idToken: token,
        email: u.email,
      });
      if (!res?.success) {
        setSearchError(res?.error || "Failed to send reset password email.");
        return;
      }
      setNotice(`Reset password email sent to ${u.email}.`);
    } finally {
      setSendingUid(null);
    }
  };

  useEffect(() => {
    if (!token) return;
    runSearch("");
  }, [token, runSearch]);

  return (
    <div className="space-y-6">
      <Card title="Add User" subtitle="Admin - Create dentist / front desk / admin accounts">
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="idToken" value={token} />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <input name="displayName" placeholder="Full Name" className={inputBase} required />
            <input
              name="email"
              type="email"
              placeholder="Email"
              className={inputBase}
              required
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <input
              name="password"
              type="password"
              placeholder="Temporary Password"
              className={inputBase}
              required
            />
            <select name="role" className={inputBase} defaultValue="dentist">
              <option value="dentist">Dentist</option>
              <option value="front-desk">Front Desk</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={isPending}
            className="w-full rounded-xl bg-slate-900 text-white py-2.5 font-extrabold hover:bg-black disabled:opacity-60"
          >
            {isPending ? "Creating..." : "Create Staff Account"}
          </button>

          {state.success ? (
            <p className="text-emerald-700 text-xs font-extrabold text-center">
              Account created successfully.
            </p>
          ) : null}

          {state.error ? (
            <p className="text-red-700 text-xs font-extrabold text-center">{state.error}</p>
          ) : null}
        </form>
      </Card>

      <Card title="User Search & Password Reset" subtitle="Search user and send reset password email">
        <div className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search user by name or email..."
              className={inputBase}
            />
            <button
              type="button"
              onClick={() => runSearch(query)}
              disabled={loadingUsers || !token}
              className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-extrabold text-white hover:bg-black disabled:opacity-60"
            >
              {loadingUsers ? "Searching..." : "Search"}
            </button>
          </div>

          {searchError ? <p className="text-sm font-bold text-red-600">{searchError}</p> : null}
          {notice ? <p className="text-sm font-bold text-emerald-700">{notice}</p> : null}

          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="text-left text-slate-600">
                  <th className="px-4 py-3 font-bold">Name</th>
                  <th className="px-4 py-3 font-bold">Email</th>
                  <th className="px-4 py-3 font-bold">Role</th>
                  <th className="px-4 py-3 font-bold">Verified</th>
                  <th className="px-4 py-3 font-bold">Action</th>
                </tr>
              </thead>
              <tbody>
                {users.length ? (
                  users.map((u) => (
                    <tr key={u.uid} className="border-t border-slate-200">
                      <td className="px-4 py-3 text-slate-900">{u.displayName || "-"}</td>
                      <td className="px-4 py-3 text-slate-700">{u.email}</td>
                      <td className="px-4 py-3 text-slate-700">{u.role || "-"}</td>
                      <td className="px-4 py-3 text-slate-700">{u.emailVerified ? "Yes" : "No"}</td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => handleSendReset(u)}
                          disabled={sendingUid === u.uid || !u.email}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                        >
                          {sendingUid === u.uid ? "Sending..." : "Send Reset"}
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-4 py-4 text-slate-500" colSpan={5}>
                      {loadingUsers ? "Loading users..." : "No users found."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Card>
    </div>
  );
}
