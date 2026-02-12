import React from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";

interface NoShowNotificationProps {
  patientName: string;
  date: string;
  time: string;
  serviceName: string;
  appointmentId: string;
  patientDashboardUrl: string;
  clinicName?: string;
}

export const NoShowNotificationEmail = ({
  patientName,
  date,
  time,
  serviceName,
  appointmentId,
  patientDashboardUrl,
  clinicName = "Dental Clinic",
}: NoShowNotificationProps) => {
  return (
    <Html>
      <Head />
      <Preview>Appointment marked as no show</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Appointment Marked as No Show</Heading>
          <Text style={text}>Hi {patientName},</Text>
          <Text style={text}>
            Your appointment was marked as <strong>No Show</strong>. Please book again using your
            patient dashboard.
          </Text>

          <Section style={detailsContainer}>
            <Text style={detailRow}>
              <strong>Service:</strong> {serviceName}
            </Text>
            <Text style={detailRow}>
              <strong>Date:</strong> {date}
            </Text>
            <Text style={detailRow}>
              <strong>Time:</strong> {time}
            </Text>
            <Text style={detailRow}>
              <strong>Reference ID:</strong> {appointmentId}
            </Text>
          </Section>

          <Section style={buttonContainer}>
            <Button style={button} href={patientDashboardUrl}>
              Book Again on Patient Dashboard
            </Button>
          </Section>

          <Hr style={hr} />

          <Text style={footer}>
            {clinicName}
            <br />
            If you need help, please contact our front desk.
          </Text>
        </Container>
      </Body>
    </Html>
  );
};

const main = {
  backgroundColor: "#f6f9fc",
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
};

const container = {
  backgroundColor: "#ffffff",
  margin: "0 auto",
  padding: "20px 0 48px",
  marginBottom: "64px",
};

const h1 = {
  color: "#333",
  fontSize: "24px",
  fontWeight: "bold",
  textAlign: "center" as const,
  margin: "30px 0",
};

const text = {
  color: "#333",
  fontSize: "16px",
  lineHeight: "26px",
  padding: "0 40px",
};

const detailsContainer = {
  padding: "20px 40px",
  backgroundColor: "#f9f9f9",
  marginBottom: "20px",
};

const detailRow = {
  margin: "10px 0",
  color: "#555",
  fontSize: "16px",
};

const buttonContainer = {
  textAlign: "center" as const,
  margin: "30px 0",
};

const button = {
  backgroundColor: "#0f766e",
  borderRadius: "5px",
  color: "#fff",
  fontSize: "16px",
  fontWeight: "bold",
  textDecoration: "none",
  textAlign: "center" as const,
  display: "block",
  padding: "12px 20px",
};

const hr = {
  borderColor: "#e6ebf1",
  margin: "20px 0",
};

const footer = {
  color: "#8898aa",
  fontSize: "12px",
  lineHeight: "16px",
  textAlign: "center" as const,
};
