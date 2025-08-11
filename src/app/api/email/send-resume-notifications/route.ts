import { NextRequest } from "next/server";
import { getUser } from "@/lib/getUser";
import sgMail from '@sendgrid/mail';

interface SubmissionData {
  name: string;
  email: string;
  airlinePreference: string;
  position?: string;
  selectedTemplates?: string[];
}

const PILOT_TEMPLATE_ID = process.env.SENDGRID_PILOT_CONFIRMATION_TEMPLATE_ID;
const ADMIN_TEMPLATE_ID = process.env.SENDGRID_ADMIN_NOTIFICATION_TEMPLATE_ID;

async function deliverEmail(recipient: string, templateId: string, templateData: any) {
  if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_FROM_EMAIL) {
    console.log('Email service not configured');
    return { sent: false, reason: 'Email service unavailable' };
  }

  sgMail.setApiKey(process.env.SENDGRID_API_KEY);

  try {
    const emailConfig = {
      to: recipient,
      from: {
        email: process.env.SENDGRID_FROM_EMAIL,
        name: process.env.SENDGRID_FROM_NAME || 'Spitfire Elite Aviation'
      },
      templateId: templateId,
      dynamicTemplateData: templateData,
    };

    console.log(`Delivering email to ${recipient} using template ${templateId}`);
    
    const result = await sgMail.send(emailConfig);
    console.log(`Email delivered successfully (${result[0].statusCode})`);
    
    return { 
      sent: true, 
      messageId: result[0].headers['x-message-id']
    };
  } catch (err: any) {
    console.error('Email delivery failed:', err.message);
    return { 
      sent: false, 
      reason: err.message,
      errorCode: err.code
    };
  }
}

function buildPilotEmailData(data: SubmissionData) {
  const now = new Date();
  const templateList = data.selectedTemplates?.filter(t => t.trim()) || [];
  
  return {
    pilotName: data.name,
    airline: data.airlinePreference,
    position: data.position || 'Not specified',
    hasPosition: Boolean(data.position && data.position.trim()),
    selectedTemplatesText: templateList.length > 0 ? templateList.join(', ') : 'None selected',
    hasSelectedTemplates: templateList.length > 0,
    submissionDate: now.toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    }),
    currentYear: now.getFullYear(),
    companyName: 'Spitfire Elite Aviation',
    supportEmail: process.env.SUPPORT_EMAIL || 'support@spitfirepremier.com'
  };
}

function buildAdminEmailData(data: SubmissionData) {
  const now = new Date();
  const templateList = data.selectedTemplates?.filter(t => t.trim()) || [];
  
  return {
    pilotName: data.name,
    pilotEmail: data.email,
    airline: data.airlinePreference,
    position: data.position || 'Not specified',
    hasPosition: Boolean(data.position && data.position.trim()),
    selectedTemplatesText: templateList.length > 0 ? templateList.join(', ') : 'None',
    hasSelectedTemplates: templateList.length > 0,
    submissionDate: now.toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    }),
    submissionTime: now.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short'
    }),
    dashboardUrl: process.env.ADMIN_DASHBOARD_URL || 'https://admin.spitfirepremier.com'
  };
}

export async function POST(request: NextRequest) {
  try {
    const user = await getUser(request);
    if (!user) {
      return Response.json({ success: false, error: "Not authorized" }, { status: 401 });
    }

    const requestData: SubmissionData = await request.json();
    
    if (!requestData.name?.trim() || !requestData.email?.trim() || !requestData.airlinePreference?.trim()) {
      return Response.json(
        { success: false, error: "Pilot name, email, and airline are required" },
        { status: 400 }
      );
    }

    if (!/\S+@\S+\.\S+/.test(requestData.email)) {
      return Response.json(
        { success: false, error: "Please provide a valid email address" },
        { status: 400 }
      );
    }

    if (!PILOT_TEMPLATE_ID || !ADMIN_TEMPLATE_ID) {
      console.error('Missing email templates in environment config');
      return Response.json(
        { success: false, error: "Email system configuration error" },
        { status: 500 }
      );
    }

    console.log(`Processing submission from ${requestData.name} (${requestData.airlinePreference})`);

    const pilotData = buildPilotEmailData(requestData);
    const adminData = buildAdminEmailData(requestData);
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@spitfirepremier.com';

    const [pilotResult, adminResult] = await Promise.allSettled([
      deliverEmail(requestData.email, PILOT_TEMPLATE_ID, pilotData),
      deliverEmail(adminEmail, ADMIN_TEMPLATE_ID, adminData)
    ]);

    let pilotEmailSent = false;
    let adminEmailSent = false;
    const emailErrors = [];

    if (pilotResult.status === 'fulfilled' && pilotResult.value.sent) {
      pilotEmailSent = true;
      console.log('Pilot confirmation sent');
    } else {
      const error = pilotResult.status === 'fulfilled' 
        ? pilotResult.value.reason 
        : pilotResult.reason;
      emailErrors.push(`Pilot email: ${error}`);
      console.error('Failed to send pilot email:', error);
    }

    if (adminResult.status === 'fulfilled' && adminResult.value.sent) {
      adminEmailSent = true;
      console.log('Admin notification sent');
    } else {
      const error = adminResult.status === 'fulfilled' 
        ? adminResult.value.reason 
        : adminResult.reason;
      emailErrors.push(`Admin email: ${error}`);
      console.error('Failed to send admin email:', error);
    }

    const responseData: any = {
      success: pilotEmailSent || adminEmailSent,
      pilotEmailSent,
      adminEmailSent
    };

    if (emailErrors.length > 0) {
      responseData.errors = emailErrors;
    }

    console.log('Email processing complete:', responseData);
    return Response.json(responseData);

  } catch (error: any) {
    console.error('Submission processing error:', error);
    return Response.json(
      { success: false, error: 'Failed to process submission' },
      { status: 500 }
    );
  }
}