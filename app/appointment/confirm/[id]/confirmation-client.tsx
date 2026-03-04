"use client";

import { useState } from "react";
import { confirmAppointmentAction, cancelAppointmentAction } from "@/app/actions/appointment-actions";
import { useRouter } from "next/navigation";

export default function ConfirmationClient({ 
  id, 
  service, 
  date, 
  time 
}: { 
  id: string;
  service: string;
  date: string;
  time: string;
}) {
  const [status, setStatus] = useState<"idle" | "loading" | "confirmed" | "cancelled" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const router = useRouter();

  const handleConfirm = async () => {
    setStatus("loading");
    try {
      const result = await confirmAppointmentAction(id);
      if (result.success) {
        setStatus("confirmed");
      } else {
        setStatus("error");
        setErrorMessage(result.error || "Failed to confirm.");
      }
    } catch (e) {
      setStatus("error");
      setErrorMessage("An unexpected error occurred.");
    }
  };

  const handleCancel = async () => {
    if (!window.confirm("Are you sure you want to cancel this appointment?")) return;
    const enteredReason = window.prompt(
      "Optional: Enter cancellation reason. If this appointment is already confirmed, reason is required."
    );
    const cancelReason = String(enteredReason || "").trim() || undefined;

    setStatus("loading");
    try {
      const result = await cancelAppointmentAction(id, cancelReason);
      if (result.success) {
        setStatus("cancelled");
      } else {
        setStatus("error");
        setErrorMessage(result.error || "Failed to cancel.");
      }
    } catch (e) {
      setStatus("error");
      setErrorMessage("An unexpected error occurred.");
    }
  };

  if (status === "confirmed") {
    return (
      <div className="text-center p-8 bg-green-50 rounded-lg border border-green-200">
        <h2 className="text-2xl font-bold text-green-700 mb-2">Confirmed!</h2>
        <p className="text-green-600">
          Your appointment for {service} on {date} at {time} is successfully confirmed.
        </p>
        <p className="mt-4 text-sm text-gray-500">
          We look forward to seeing you. You can close this page.
        </p>
      </div>
    );
  }

  if (status === "cancelled") {
    return (
      <div className="text-center p-8 bg-gray-50 rounded-lg border border-gray-200">
        <h2 className="text-2xl font-bold text-gray-700 mb-2">Appointment Cancelled</h2>
        <p className="text-gray-600">
          Your appointment has been cancelled as requested.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto bg-white p-8 rounded-lg shadow-md border border-gray-100">
      <h1 className="text-2xl font-bold text-gray-900 mb-4">Appointment Actions</h1>
      
      <div className="mb-6 space-y-2">
        <p className="text-gray-600">Please choose an action for:</p>
        <div className="bg-gray-50 p-4 rounded-md">
          <p className="font-medium text-gray-900">{service}</p>
          <p className="text-gray-700">{date} at {time}</p>
        </div>
      </div>

      {status === "error" && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-md text-sm">
          {errorMessage}
        </div>
      )}

      <div className="space-y-3">
        <button
          onClick={handleConfirm}
          disabled={status === "loading"}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-md transition-colors disabled:opacity-50"
        >
          {status === "loading" ? "Processing..." : "Confirm Appointment"}
        </button>

        <button
          onClick={handleCancel}
          disabled={status === "loading"}
          className="w-full bg-white hover:bg-red-50 text-red-600 font-semibold py-3 px-4 rounded-md border border-red-200 transition-colors disabled:opacity-50"
        >
          Cancel Appointment
        </button>
      </div>
      
      <p className="mt-4 text-xs text-gray-400 text-center">
        Reference ID: {id}
      </p>
    </div>
  );
}
