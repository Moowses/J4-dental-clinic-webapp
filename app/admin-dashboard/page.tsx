"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { useAuth } from "@/lib/hooks/useAuth";

import PatientRecordsPanel from "@/components/admin/PatientRecordsPanel";
import ClinicSchedulePanel from "@/components/admin/ClinicSchedulePanel";
import InventoryPanel from "@/components/admin/InventoryPanel";
import DentistSchedulePanel from "@/components/admin/DentistSchedulePanel";

import StaffHRPanel from "@/components/admin/StaffHRPanel";
import ProceduresPanel from "@/components/admin/ProceduresPanel";

import UpcomingAppointmentsPanel from "@/components/admin/UpcomingAppointmentsPanel";
import UnassignedAppointmentsPanel from "@/components/admin/UnassignedAppointmentsPanel";

import BillingOverviewPanel from "@/components/admin/BillingOverviewPanel";
import BillingPaymentPlansPanel from "@/components/admin/BillingPaymentPlansPanel";
import { getAllAppointments } from "@/lib/services/appointment-service";
import { getAllBillingRecords } from "@/lib/services/billing-service";
import { getInventory } from "@/lib/services/inventory-service";
import WalkInBookingModal from "@/components/WalkInBookingModal";
import ReportsPanel from "@/components/admin/ReportsPanel";
import StaffAccountSettingsPanel from "@/components/admin/StaffAccountSettingsPanel";
import DashboardAnalyticsPanel from "@/components/admin/DashboardAnalyticsPanel";
import TreatmentRecordsPanel from "@/components/admin/TreatmentRecordsPanel";
import DentistOverviewInsightsPanel from "@/components/admin/DentistOverviewInsightsPanel";

// ✅ NEW
import ClinicSettings from "@/components/admin/ClinicSettings";

type TabKey =
  | "dashboard"
  | "dentist-appointment"
  | "appointments"
  | "billing"
  | "inventory"
  | "reports"
  | "patients"
  | "treatment-records"
  | "staff"
  | "procedures"
  | "account-settings"
  | "clinic-settings"; // ✅ NEW

type ApptTab = "calendar" | "upcoming" | "unassigned";

const APPT_SUB_ITEMS = [
  { key: "calendar" as const, label: "Calendar" },
  { key: "upcoming" as const, label: "Upcoming" },
  { key: "unassigned" as const, label: "Unassigned" },
] as const;

export default function AdminDashboardPage() {
  const router = useRouter();
  const { user, role, loading, logout } = useAuth();

  const [tab, setTab] = useState<TabKey>("dashboard");
  const [apptTab, setApptTab] = useState<ApptTab>("calendar");
  const [activeBillingId, setActiveBillingId] = useState<string | null>(null);

  // IMPORTANT: forces BillingOverview to refetch after modal updates/close
  const [billingRefreshKey, setBillingRefreshKey] = useState(0);

  const isAdmin = role === "admin";
  const isDentist = role === "dentist";
  const isFrontDesk = role === "front-desk";

  const canSeeAppointments = isAdmin || isFrontDesk;
  const canSeeBilling = isAdmin || isFrontDesk;
  const canSeeInventory = isAdmin;
  const canSeeReports = isAdmin;
  const canSeeAnalytics = isAdmin;
  const canSeeTreatmentRecords = isAdmin || isDentist;

  // ✅ NEW
  const canSeeClinicSettings = isAdmin || isFrontDesk;

  const showClinicOverview = isAdmin || isFrontDesk;
  const canSeeWalkInBooking = isAdmin || isFrontDesk;
  const [walkInOpen, setWalkInOpen] = useState(false);

  const [clinicOverview, setClinicOverview] = useState({
    todaysAppointments: 0,
    monthlySales: 0,
    lowStockItems: 0,
  });

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/admin");
  }, [user, loading, router]);

  useEffect(() => {
      if (!loading && user) {
        if (tab === "appointments" && !canSeeAppointments) setTab("dashboard");
        if (tab === "billing" && !canSeeBilling) setTab("dashboard");
        if (tab === "inventory" && !canSeeInventory) setTab("dashboard");
        if (tab === "reports" && !canSeeReports) setTab("dashboard");
        if (tab === "treatment-records" && !canSeeTreatmentRecords) setTab("dashboard");
        if (tab === "clinic-settings" && !canSeeClinicSettings) setTab("dashboard"); // ✅ NEW
        if (tab === "dentist-appointment" && !isDentist) setTab("dashboard");
      }
    }, [
      tab,
      canSeeAppointments,
      canSeeBilling,
      canSeeInventory,
      canSeeReports,
      canSeeTreatmentRecords,
      canSeeClinicSettings,
      isDentist,
      loading,
      user,
    ]);

  // Clinic overview metrics
  useEffect(() => {
    if (loading || !user) return;
    if (!showClinicOverview) return;

    const toISODate = (d: Date) => {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    };

    const toDateSafe = (v: any): Date | null => {
      if (!v) return null;
      if (v instanceof Date) return v;
      if (typeof v?.toDate === "function") return v.toDate(); // Firestore Timestamp
      if (typeof v?.seconds === "number") return new Date(v.seconds * 1000);
      return null;
    };

    const load = async () => {
      try {
        const today = toISODate(new Date());
        const apptRes = await getAllAppointments(today);
        const todaysAppointments =
          apptRes?.success && Array.isArray(apptRes.data)
            ? apptRes.data.length
            : 0;

        const now = new Date();
        const monthStart = new Date(
          now.getFullYear(),
          now.getMonth(),
          1,
          0,
          0,
          0,
          0
        );
        const monthEnd = new Date(
          now.getFullYear(),
          now.getMonth() + 1,
          1,
          0,
          0,
          0,
          0
        );

        const billsRes = await getAllBillingRecords("all");
        const bills =
          billsRes?.success && Array.isArray(billsRes.data) ? billsRes.data : [];

        let monthlySales = 0;

        for (const b of bills) {
          const txs = Array.isArray((b as any)?.transactions)
            ? (b as any).transactions
            : [];
          for (const tx of txs) {
            const d = toDateSafe(tx?.date);
            if (!d) continue;
            if (d >= monthStart && d < monthEnd) {
              monthlySales += Number(tx?.amount || 0);
            }
          }
        }

        let items: any[] = [];
        if (isAdmin) {
          const invRes = await getInventory(true);
          items = invRes?.success && Array.isArray(invRes.data) ? invRes.data : [];
        }

        const getThreshold = (it: any) => {
          const t =
            it?.minThreshold ??
            it?.min ??
            it?.minStock ??
            it?.minimumStock ??
            it?.minQty ??
            it?.reorderLevel ??
            it?.threshold ??
            it?.lowStockThreshold ??
            null;

          const num = Number(t);
          return Number.isFinite(num) ? num : null;
        };

        let lowStockItems = 0;
        for (const it of items) {
          const stock = Number(it?.stock);
          const threshold = getThreshold(it);
          if (!Number.isFinite(stock)) continue;
          if (threshold === null) continue;
          if (stock <= threshold) lowStockItems += 1;
        }

        setClinicOverview((prev) => ({
          ...prev,
          todaysAppointments,
          monthlySales,
          lowStockItems,
        }));
      } catch (e) {
        console.error("Failed to load clinic overview:", e);
        setClinicOverview((prev) => ({
          ...prev,
          todaysAppointments: 0,
          monthlySales: 0,
          lowStockItems: 0,
        }));
      }
    };

    load();
  }, [loading, user, showClinicOverview]);

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-slate-500 font-bold animate-pulse">
        Initializing Admin Dashboard... note please dont share the
        http://159.223.94.124:3000
      </div>
    );
  }

  if (!user) return null;

  if (role === "client") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
        <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
          <p className="text-xs uppercase tracking-widest font-extrabold text-slate-400">
            Access Denied
          </p>
          <p className="font-extrabold text-slate-900">
            You are signed in as a client.
          </p>
          <div className="flex gap-2">
            <button
              onClick={logout}
              className="flex-1 px-4 py-2 rounded-xl bg-red-50 text-red-700 font-extrabold text-sm hover:bg-red-100"
            >
              Sign Out
            </button>
            <Link
              href="/"
              className="flex-1 px-4 py-2 rounded-xl bg-slate-100 text-slate-900 font-extrabold text-sm text-center hover:bg-slate-200"
            >
              Go Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const goAppointments = (sub: ApptTab) => {
    setTab("appointments");
    setApptTab(sub);
  };

  const goBilling = () => {
    setTab("billing");
    setActiveBillingId(null);
  };

  const goInventory = () => setTab("inventory");

  const getMetricSizeClass = (displayValue: string) => {
    const len = displayValue.length;
    if (len >= 16) return "text-lg sm:text-xl";
    if (len >= 12) return "text-xl sm:text-2xl";
    if (len >= 9) return "text-2xl sm:text-3xl";
    return "text-3xl";
  };

  const todaysAppointmentsDisplay = Number(
    clinicOverview.todaysAppointments || 0
  ).toLocaleString();
  const monthlySalesDisplay = `PHP ${Number(
    clinicOverview.monthlySales || 0
  ).toLocaleString()}`;
  const lowStockDisplay = Number(clinicOverview.lowStockItems || 0).toLocaleString();

  return (
    <div className="min-h-screen bg-[#f6f8fb]">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
          {/* Sidebar */}
          <aside className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 h-fit">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center">
                🦷
              </div>
              <div className="min-w-0">
                <p className="font-extrabold text-slate-900 truncate">
                  Management Portal
                </p>
                <p className="text-xs text-slate-500 truncate">{user.email}</p>
              </div>
            </div>

            <div className="mt-5 space-y-2">
              <button
                className={`w-full text-left px-4 py-3 rounded-xl font-extrabold ${
                  tab === "dashboard"
                    ? "bg-slate-900 text-white"
                    : "bg-white border border-slate-200 hover:bg-slate-50 text-slate-900"
                }`}
                onClick={() => setTab("dashboard")}
              >
                Dashboard
              </button>

              {isDentist && (
                <button
                  className={`w-full text-left px-4 py-3 rounded-xl font-extrabold ${
                    tab === "dentist-appointment"
                      ? "bg-slate-900 text-white"
                      : "bg-white border border-slate-200 hover:bg-slate-50 text-slate-900"
                  }`}
                  onClick={() => setTab("dentist-appointment")}
                >
                  Appointment
                </button>
              )}

              {canSeeAppointments && (
                <div>
                  <button
                    className={`w-full text-left px-4 py-3 rounded-xl font-extrabold ${
                      tab === "appointments"
                        ? "bg-slate-900 text-white"
                        : "bg-white border border-slate-200 hover:bg-slate-50 text-slate-900"
                    }`}
                    onClick={() => setTab("appointments")}
                  >
                    Appointments
                  </button>

                  {tab === "appointments" && (
                    <div className="mt-2 space-y-2 pl-2">
                      {APPT_SUB_ITEMS.map((s) => {
                        const active = apptTab === s.key;
                        return (
                          <button
                            key={s.key}
                            className={`w-full text-left px-4 py-2 rounded-xl font-extrabold text-sm ${
                              active
                                ? "bg-slate-100 text-slate-900 border border-slate-200"
                                : "bg-white border border-slate-200 hover:bg-slate-50 text-slate-700"
                            }`}
                            onClick={() => goAppointments(s.key)}
                          >
                            {s.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {canSeeBilling && (
                <button
                  className={`w-full text-left px-4 py-3 rounded-xl font-extrabold ${
                    tab === "billing"
                      ? "bg-slate-900 text-white"
                      : "bg-white border border-slate-200 hover:bg-slate-50 text-slate-900"
                  }`}
                  onClick={goBilling}
                >
                  Billing
                </button>
              )}

              {canSeeInventory && (
                <button
                  className={`w-full text-left px-4 py-3 rounded-xl font-extrabold ${
                    tab === "inventory"
                      ? "bg-slate-900 text-white"
                      : "bg-white border border-slate-200 hover:bg-slate-50 text-slate-900"
                  }`}
                  onClick={goInventory}
                >
                  Inventory
                </button>
              )}

              {canSeeReports && (
                <button
                  className={`w-full text-left px-4 py-3 rounded-xl font-extrabold ${
                    tab === "reports"
                      ? "bg-slate-900 text-white"
                      : "bg-white border border-slate-200 hover:bg-slate-50 text-slate-900"
                  }`}
                  onClick={() => setTab("reports")}
                >
                  Reports
                </button>
              )}

              <button
                className={`w-full text-left px-4 py-3 rounded-xl font-extrabold ${
                  tab === "patients"
                    ? "bg-slate-900 text-white"
                    : "bg-white border border-slate-200 hover:bg-slate-50 text-slate-900"
                }`}
                onClick={() => setTab("patients")}
              >
                Patient Records
              </button>
              {canSeeTreatmentRecords && (
                <button
                  className={`w-full text-left px-4 py-3 rounded-xl font-extrabold ${
                    tab === "treatment-records"
                      ? "bg-slate-900 text-white"
                      : "bg-white border border-slate-200 hover:bg-slate-50 text-slate-900"
                  }`}
                  onClick={() => setTab("treatment-records")}
                >
                  Treatment Records
                </button>
              )}

              {isAdmin && (
                <>
                  <button
                    className={`w-full text-left px-4 py-3 rounded-xl font-extrabold ${
                      tab === "staff"
                        ? "bg-slate-900 text-white"
                        : "bg-white border border-slate-200 hover:bg-slate-50 text-slate-900"
                    }`}
                    onClick={() => setTab("staff")}
                  >
                    Management
                  </button>

                  <button
                    className={`w-full text-left px-4 py-3 rounded-xl font-extrabold ${
                      tab === "procedures"
                        ? "bg-slate-900 text-white"
                        : "bg-white border border-slate-200 hover:bg-slate-50 text-slate-900"
                    }`}
                    onClick={() => setTab("procedures")}
                  >
                    Procedures
                  </button>
                </>
              )}

              {/* ✅ NEW: Clinic Settings (Admin + Front Desk only) */}
                {canSeeClinicSettings && (
                  <button
                    className={`w-full text-left px-4 py-3 rounded-xl font-extrabold ${
                      tab === "clinic-settings"
                        ? "bg-slate-900 text-white"
                        : "bg-white border border-slate-200 hover:bg-slate-50 text-slate-900"
                    }`}
                    onClick={() => setTab("clinic-settings")}
                  >
                    Clinic Settings
                  </button>
                )}

                <button
                  className={`w-full text-left px-4 py-3 rounded-xl font-extrabold ${
                    tab === "account-settings"
                      ? "bg-slate-900 text-white"
                      : "bg-white border border-slate-200 hover:bg-slate-50 text-slate-900"
                  }`}
                  onClick={() => setTab("account-settings")}
                >
                  Account Settings
                </button>

              <div className="pt-3 mt-3 border-t border-slate-100">
                <button
                  className="w-full text-left px-4 py-3 rounded-xl hover:bg-red-50 font-extrabold text-red-600"
                  onClick={logout}
                >
                  Logout
                </button>
              </div>
            </div>
          </aside>

          {/* Main */}
          <main className="space-y-6">
            {/* Hero */}
            <section className="rounded-2xl overflow-hidden shadow-sm border border-slate-200">
              <div className="bg-gradient-to-r from-[#0f5f73] to-[#1aa4c7] px-6 py-6 flex flex-col md:flex-row md:items-center md:justify-between gap-5">
                  <div className="flex items-center gap-4">
                    <div className="h-14 w-14 rounded-2xl bg-white/20 border border-white/25 overflow-hidden flex items-center justify-center">
                      {user?.photoURL ? (
                        <img src={user.photoURL} alt={user.displayName || "Staff"} className="h-full w-full object-cover" />
                      ) : (
                        <span className="text-white font-extrabold text-xl">🏥</span>
                      )}
                    </div>
                  <div className="text-white">
                    <p className="text-xs font-bold opacity-90">Staff Dashboard</p>
                    <p className="text-xl sm:text-2xl font-extrabold leading-tight break-words [overflow-wrap:anywhere]">
                      {user.displayName || "Staff"}
                    </p>
                    <p className="text-sm opacity-90 break-all">{user.email}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="hidden sm:block text-white/90 text-sm font-bold">
                    Role:{" "}
                    <span className="uppercase font-extrabold">
                      {role || "staff"}
                    </span>
                  </div>
                </div>
              </div>
            </section>

            {/* Dashboard */}
            {tab === "dashboard" && (
              <div className="space-y-6">
                {showClinicOverview && (
                  <section className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
                    <div className="flex items-end justify-between gap-3">
                      <div>
                        <p className="text-lg sm:text-xl font-extrabold text-slate-900">
                          Clinic Overview
                        </p>
                        <p className="text-sm text-slate-500">
                          Quick snapshot of today and this month.
                        </p>
                      </div>
                      <p className="text-xs text-slate-400 font-bold">
                        Updated automatically
                      </p>
                    </div>

                    <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                      <button
                        type="button"
                        onClick={() => goAppointments("calendar")}
                        className="text-left rounded-2xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition p-5"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-extrabold text-slate-600">
                              Today&apos;s Appointments
                            </p>
                            <p
                              className={`mt-2 font-extrabold text-slate-900 leading-tight break-words [overflow-wrap:anywhere] tabular-nums ${getMetricSizeClass(
                                todaysAppointmentsDisplay
                              )}`}
                            >
                              {todaysAppointmentsDisplay}
                            </p>
                            <p className="mt-2 text-xs text-slate-500">
                              Click to open the calendar
                            </p>
                          </div>
                          <div className="h-10 w-10 rounded-full bg-purple-100 flex items-center justify-center">
                            <span className="text-purple-700">📅</span>
                          </div>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={goBilling}
                        className="text-left rounded-2xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition p-5"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-extrabold text-slate-600">
                              Total Sales (This Month)
                            </p>
                            <p
                              className={`mt-2 font-extrabold text-slate-900 leading-tight break-words [overflow-wrap:anywhere] tabular-nums ${getMetricSizeClass(
                                monthlySalesDisplay
                              )}`}
                            >
                              ₱{Number(clinicOverview.monthlySales || 0).toLocaleString()}
                            </p>
                            <p className="mt-2 text-xs text-slate-500">
                              Click to view billing
                            </p>
                          </div>
                          <div className="h-10 w-10 rounded-full bg-amber-100 flex items-center justify-center">
                            <span className="text-amber-700">💳</span>
                          </div>
                        </div>
                      </button>

                      {canSeeInventory && (
                        <button
                          type="button"
                          onClick={goInventory}
                          className="text-left rounded-2xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition p-5"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-extrabold text-slate-600">
                                Low Stock Items
                              </p>
                              <p
                                className={`mt-2 font-extrabold text-slate-900 leading-tight break-words [overflow-wrap:anywhere] tabular-nums ${getMetricSizeClass(
                                  lowStockDisplay
                                )}`}
                              >
                                {lowStockDisplay}
                              </p>
                              <p className="mt-2 text-xs text-slate-500">
                                Click to open inventory
                              </p>
                            </div>
                            <div className="h-10 w-10 rounded-full bg-red-100 flex items-center justify-center">
                              <span className="text-red-700">⚠️</span>
                            </div>
                          </div>
                        </button>
                      )}
                    </div>
                  </section>
                )}

                {isDentist && <DentistOverviewInsightsPanel />}
                {canSeeAnalytics && <DashboardAnalyticsPanel />}
              </div>
            )}

            {tab === "dentist-appointment" && isDentist && (
              <div className="space-y-6">
                <DentistSchedulePanel />
              </div>
            )}

            {/* Appointments */}
            {tab === "appointments" && canSeeAppointments && (
              <div className="space-y-6">
                <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <p className="text-lg font-extrabold text-slate-900">
                        Appointments
                      </p>
                      <p className="text-sm text-slate-500">
                        Calendar, upcoming bookings, and unassigned queue.
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {(isAdmin || isFrontDesk) && (
                        <button
                          type="button"
                          onClick={() => setWalkInOpen(true)}
                          className="px-4 py-2 rounded-xl font-extrabold text-sm bg-emerald-600 text-white hover:opacity-95 transition"
                        >
                          + Walk-In Booking
                        </button>
                      )}

                      {APPT_SUB_ITEMS.map((t) => {
                        const active = apptTab === t.key;
                        return (
                          <button
                            key={t.key}
                            onClick={() => setApptTab(t.key)}
                            className={`px-4 py-2 rounded-xl font-extrabold text-sm transition ${
                              active
                                ? "bg-slate-900 text-white"
                                : "bg-white border border-slate-200 hover:bg-slate-50 text-slate-900"
                            }`}
                          >
                            {t.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {apptTab === "calendar" && <ClinicSchedulePanel />}
                {apptTab === "upcoming" && <UpcomingAppointmentsPanel />}
                {apptTab === "unassigned" && <UnassignedAppointmentsPanel />}

                {(isAdmin || isFrontDesk) && (
                  <WalkInBookingModal
                    open={walkInOpen}
                    onClose={() => setWalkInOpen(false)}
                    onBooked={() => {
                      setWalkInOpen(false);
                      setApptTab("upcoming");
                    }}
                    forceStaff
                  />
                )}
              </div>
            )}

            {/* Billing */}
            {tab === "billing" && canSeeBilling && (
              <div className="space-y-6">
                <BillingOverviewPanel
                  refreshKey={billingRefreshKey}
                  onSelectBill={(id) => {
                    setActiveBillingId(id);
                    setTab("billing");
                  }}
                />

                {activeBillingId ? (
                  <BillingPaymentPlansPanel
                    billingId={activeBillingId}
                    onClose={() => {
                      setActiveBillingId(null);
                      setBillingRefreshKey((k) => k + 1);
                    }}
                    onUpdated={() => setBillingRefreshKey((k) => k + 1)}
                  />
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8">
                    <p className="text-lg font-extrabold text-slate-900">
                      Select a bill to manage payments.
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      Choose items to mark as paid or create an installment plan.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Reports */}
            {tab === "reports" && canSeeReports && (
              <div className="space-y-6">
                <ReportsPanel />
              </div>
            )}

            {/* Inventory */}
            {tab === "inventory" && canSeeInventory && (
              <div className="space-y-6">
                <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4">
                  <p className="text-lg font-extrabold text-slate-900">
                    Inventory
                  </p>
                  <p className="text-sm text-slate-500">
                    Track supplies, stock levels, and low-stock alerts.
                  </p>
                </div>
                <InventoryPanel />
              </div>
            )}

              {/*Clinic Settings */}
              {tab === "clinic-settings" && canSeeClinicSettings && (
                <div className="space-y-6">
                  <ClinicSettings />
                </div>
              )}

              {tab === "account-settings" && (
                <div className="space-y-6">
                  <StaffAccountSettingsPanel />
                </div>
              )}

            {tab === "patients" && <PatientRecordsPanel />}
            {tab === "treatment-records" && canSeeTreatmentRecords && <TreatmentRecordsPanel />}
            {tab === "staff" && isAdmin && <StaffHRPanel />}
            {tab === "procedures" && isAdmin && <ProceduresPanel />}

            <div className="text-center text-xs text-slate-400 py-6">
              J4 Dental Clinic • Staff Dashboard
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

