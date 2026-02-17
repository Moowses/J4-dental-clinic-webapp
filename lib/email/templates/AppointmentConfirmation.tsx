import React from 'react';
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
} from '@react-email/components';

interface AppointmentConfirmationProps {
  patientName: string;
  date: string;
  time: string;
  serviceName: string;
  appointmentId: string;
  clinicName?: string;
  appointmentDetailsUrl: string;
  isRescheduled?: boolean;
  previousDate?: string;
  previousTime?: string;
  patientLabel?: string;
}

export const AppointmentConfirmationEmail = ({
  patientName,
  date,
  time,
  serviceName,
  appointmentId,
  clinicName = "Dental Clinic",
  appointmentDetailsUrl,
  isRescheduled = false,
  previousDate,
  previousTime,
  patientLabel,
}: AppointmentConfirmationProps) => {
  return (
    <Html>
      <Head />
      <Preview>
        {isRescheduled ? "Appointment Rescheduled" : "Appointment Confirmed"} at {clinicName}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>
            {isRescheduled ? "Appointment Rescheduled" : "Appointment Confirmed"}
          </Heading>
          <Text style={text}>Hi {patientName},</Text>
          <Text style={text}>
            {isRescheduled
              ? "Your appointment has been rescheduled."
              : "Your appointment has been scheduled."}{" "}
            Appointment for <strong>{patientLabel || serviceName}</strong>.
          </Text>
          
          <Section style={detailsContainer}>
            {isRescheduled && previousDate && previousTime ? (
              <>
                <Text style={detailRow}><strong>Previous Date:</strong> {previousDate}</Text>
                <Text style={detailRow}><strong>Previous Time:</strong> {previousTime}</Text>
              </>
            ) : null}
            <Text style={detailRow}><strong>Date:</strong> {date}</Text>
            <Text style={detailRow}><strong>Time:</strong> {time}</Text>
            <Text style={detailRow}><strong>Reference ID:</strong> {appointmentId}</Text>
          </Section>

          <Text style={text}>
            Your appointment has been approved by the clinic team. No further confirmation is required from your side.
          </Text>

          <Section style={buttonContainer}>
            <Button style={button} href={appointmentDetailsUrl}>
              View Appointment
            </Button>
          </Section>
          
          <Text style={text}>
            We have attached a calendar invite to this email. Please add it to your calendar!
          </Text>
          <Text style={text}>
            Policy: Cancellations are not allowed within 3 hours before your appointment time.
          </Text>

          <Hr style={hr} />
          
          <Text style={footer}>
            {clinicName} - 123 Dental Street, City<br />
            If you need to reschedule, please contact us immediately.
          </Text>
        </Container>
      </Body>
    </Html>
  );
};

export default AppointmentConfirmationEmail;

const main = {
  backgroundColor: '#f6f9fc',
  fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
};

const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '20px 0 48px',
  marginBottom: '64px',
};

const h1 = {
  color: '#333',
  fontSize: '24px',
  fontWeight: 'bold',
  textAlign: 'center' as const,
  margin: '30px 0',
};

const text = {
  color: '#333',
  fontSize: '16px',
  lineHeight: '26px',
  padding: '0 40px',
};

const detailsContainer = {
  padding: '20px 40px',
  backgroundColor: '#f9f9f9',
  marginBottom: '20px',
};

const detailRow = {
  margin: '10px 0',
  color: '#555',
  fontSize: '16px',
};

const buttonContainer = {
  textAlign: 'center' as const,
  margin: '30px 0',
};

const button = {
  backgroundColor: '#007bff',
  borderRadius: '5px',
  color: '#fff',
  fontSize: '16px',
  fontWeight: 'bold',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'block',
  padding: '12px 20px',
};

const hr = {
  borderColor: '#e6ebf1',
  margin: '20px 0',
};

const footer = {
  color: '#8898aa',
  fontSize: '12px',
  lineHeight: '16px',
  textAlign: 'center' as const,
};
