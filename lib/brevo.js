import nodemailer from "nodemailer";

const host = process.env.BREVO_SMTP_HOST;
const port = parseInt(process.env.BREVO_SMTP_PORT || "587");
const user = process.env.BREVO_SMTP_USER;
const pass = process.env.BREVO_SMTP_PASSWORD;
const senderEmail = process.env.BREVO_SENDER_EMAIL || "noreply@medicalportal.com";
const senderName = process.env.BREVO_SENDER_NAME || "Medical Portal";

const hasCredentials = host && user && pass;

// Create SMTP transporter
const transporter = hasCredentials
  ? nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: {
        user,
        pass,
      },
    })
  : null;

/**
 * Send an email using Brevo SMTP.
 * If credentials are not provided, it logs the email to the console.
 */
export async function sendEmail({ to, subject, text, html }) {
  if (!transporter) {
    console.log("----------------- SMTP EMAIL LOG (NO CREDENTIALS CONFIGURED) -----------------");
    console.log(`To:      ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(`Body:    ${text || "See HTML representation"}`);
    console.log("------------------------------------------------------------------------------");
    return { success: true, loggedToConsole: true };
  }

  try {
    const info = await transporter.sendMail({
      from: `"${senderName}" <${senderEmail}>`,
      to,
      subject,
      text,
      html,
    });
    console.log(`Email sent successfully: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error("Error sending email via Brevo SMTP:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Common HTML email wrapper to enforce premium branding, typography, and structure.
 */
function emailWrapper({ title, headerEmoji, previewText, bodyHtml }) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title}</title>
      <style>
        body {
          margin: 0;
          padding: 0;
          background-color: #f8fafc;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
          -webkit-font-smoothing: antialiased;
        }
        .container {
          max-width: 540px;
          margin: 40px auto;
          background: #ffffff;
          border-radius: 16px;
          overflow: hidden;
          box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
          border: 1px solid #e2e8f0;
        }
        .header {
          background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%);
          padding: 36px 24px;
          text-align: center;
          color: #ffffff;
        }
        .header-emoji {
          display: inline-block;
          background-color: rgba(255, 255, 255, 0.15);
          padding: 12px;
          border-radius: 12px;
          margin-bottom: 16px;
          font-size: 28px;
          line-height: 1;
        }
        .header h2 {
          margin: 0;
          font-size: 22px;
          font-weight: 800;
          letter-spacing: -0.025em;
          line-height: 1.25;
        }
        .header p {
          margin: 8px 0 0 0;
          color: #e0f2fe;
          font-size: 14px;
          font-weight: 500;
        }
        .content {
          padding: 36px 32px;
          color: #334155;
          line-height: 1.6;
          font-size: 15px;
        }
        .content p {
          margin-top: 0;
          margin-bottom: 16px;
        }
        .card {
          background-color: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 20px;
          margin: 24px 0;
        }
        .card h4 {
          margin: 0 0 12px 0;
          color: #0f172a;
          font-size: 13px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .card-row {
          margin-bottom: 12px;
        }
        .card-row:last-child {
          margin-bottom: 0;
        }
        .card-label {
          display: block;
          font-size: 11px;
          color: #64748b;
          font-weight: 600;
          letter-spacing: 0.025em;
        }
        .card-value {
          font-size: 15px;
          color: #0f172a;
          font-weight: 500;
          font-family: monospace;
        }
        .card-code {
          font-family: monospace;
          background-color: #e2e8f0;
          padding: 4px 8px;
          border-radius: 6px;
          font-size: 14px;
          color: #0f172a;
          font-weight: 600;
          display: inline-block;
        }
        .btn-container {
          text-align: center;
          margin: 32px 0 24px 0;
        }
        .btn {
          display: inline-block;
          background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%);
          color: #ffffff !important;
          padding: 14px 28px;
          text-decoration: none;
          border-radius: 10px;
          font-weight: 700;
          font-size: 15px;
          box-shadow: 0 4px 10px rgba(2, 132, 199, 0.25);
          transition: transform 0.15s ease;
        }
        .footer {
          background-color: #f8fafc;
          border-top: 1px solid #e2e8f0;
          padding: 24px;
          text-align: center;
        }
        .footer p {
          font-size: 12px;
          color: #94a3b8;
          margin: 0;
        }
        .footer a {
          color: #0284c7;
          text-decoration: underline;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <!-- Header -->
        <div class="header">
          <div class="header-emoji">${headerEmoji}</div>
          <h2>${title}</h2>
          <p>${previewText}</p>
        </div>
        
        <!-- Content -->
        <div class="content">
          ${bodyHtml}
        </div>
        
        <!-- Footer -->
        <div class="footer">
          <p>MedExam Portal &copy; 2026. All rights reserved.<br>Good luck with your medical studies and assessments!</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

/**
 * 1. Sends a welcome credentials email to a student.
 */
export async function sendStudentWelcomeEmail({ name, email, password, loginUrl }) {
  const subject = "Welcome to MedExam Portal - Your Login Credentials";
  const title = "Your Medical Exam Account is Ready";
  const previewText = "Enabling gamified assessments and NEET PG mock tests";
  
  const bodyHtml = `
    <p>Hello <strong>${name}</strong>,</p>
    <p>An administrator has successfully provisioned your student account. You can now log in, take simulated mock exams, and track your clinical analytics in real-time.</p>
    
    <div class="card">
      <h4>Account Credentials</h4>
      <div class="card-row">
        <span class="card-label">EMAIL ADDRESS</span>
        <span class="card-value">${email}</span>
      </div>
      <div class="card-row">
        <span class="card-label">PASSWORD</span>
        <span class="card-code">${password}</span>
      </div>
    </div>
    
    <p>Please log in using the credentials above and reset your password on your first session to keep your profile secure.</p>
    
    <div class="btn-container">
      <a href="${loginUrl}" class="btn">Login to Portal</a>
    </div>
  `;

  const html = emailWrapper({ title, headerEmoji: "🎓", previewText, bodyHtml });
  const text = `Hello ${name},\n\nYour account has been created on the MedExam Portal.\n\nLogin credentials:\nEmail: ${email}\nPassword: ${password}\n\nLogin here: ${loginUrl}`;

  return sendEmail({ to: email, subject, text, html });
}

/**
 * 2. Sends credentials welcome email to a sub-admin.
 */
export async function sendAdminWelcomeEmail({ name, email, password, loginUrl, permissions = [] }) {
  const subject = "Welcome to the MedExam Team - Administrative Access Ready";
  const title = "Welcome, Administrator";
  const previewText = "You have been allotted administrative rights";

  const permListHtml = permissions.map(p => `
    <li style="margin-bottom: 6px; text-transform: capitalize; font-size: 13px;">
      <span style="color: #0284c7; font-weight: bold; margin-right: 6px;">✓</span> <strong>${p.replace('_', ' ')}</strong>
    </li>
  `).join('');

  const bodyHtml = `
    <p>Hello <strong>${name}</strong>,</p>
    <p>You have been registered as an Administrator on the MedExam Portal with security roles to manage features and content.</p>
    
    <div class="card">
      <h4>Admin Login Credentials</h4>
      <div class="card-row">
        <span class="card-label">SECURE EMAIL</span>
        <span class="card-value">${email}</span>
      </div>
      <div class="card-row">
        <span class="card-label">TEMPORARY PASSWORD</span>
        <span class="card-code">${password}</span>
      </div>
    </div>
    
    <h3 style="font-size: 14px; font-weight: 700; color: #0f172a; margin-top: 24px; margin-bottom: 8px;">Allotted Control Rights:</h3>
    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
      <ul style="list-style-type: none; padding: 0; margin: 0;">
        ${permListHtml || '<li style="font-size: 13px; color: #64748b;">🔑 Basic dashboard view only</li>'}
      </ul>
    </div>
    
    <div class="btn-container">
      <a href="${loginUrl}" class="btn">Enter Admin Suite</a>
    </div>
  `;

  const html = emailWrapper({ title, headerEmoji: "🛡️", previewText, bodyHtml });
  const text = `Hello ${name},\n\nYour administrator account has been set up.\n\nCredentials:\nEmail: ${email}\nPassword: ${password}\n\nLogin here: ${loginUrl}`;

  return sendEmail({ to: email, subject, text, html });
}

/**
 * 3. Sends an email to a student when a new exam is assigned/published.
 */
export async function sendExamAssignedEmail({ name, email, examName, duration, passingMarks, examUrl }) {
  const subject = `Assessment Assigned: ${examName}`;
  const title = "New Examination Assigned";
  const previewText = `Prepare to complete your test: ${examName}`;

  const bodyHtml = `
    <p>Hello <strong>${name}</strong>,</p>
    <p>A new examination has been published and assigned to your batch. Please prepare and review the test information below before attempting the session:</p>
    
    <div class="card">
      <h4>Assessment Metadata</h4>
      <div class="card-row">
        <span class="card-label">EXAMINATION NAME</span>
        <span class="card-value" style="font-family: inherit; font-weight: bold; color: #0284c7;">${examName}</span>
      </div>
      <div class="card-row flex" style="display: flex; gap: 24px;">
        <div style="flex: 1;">
          <span class="card-label">TIME LIMIT</span>
          <span class="card-value" style="font-family: inherit; font-weight: bold;">${duration} Minutes</span>
        </div>
        <div style="flex: 1;">
          <span class="card-label">PASSING RATIO</span>
          <span class="card-value" style="font-family: inherit; font-weight: bold;">${passingMarks}% Marks</span>
        </div>
      </div>
    </div>
    
    <p>Ensure a stable internet connection and active focus during the session. Exiting the window or switching tabs will trigger security anti-cheat warning alerts.</p>
    
    <div class="btn-container">
      <a href="${examUrl}" class="btn">Start Examination</a>
    </div>
  `;

  const html = emailWrapper({ title, headerEmoji: "📝", previewText, bodyHtml });
  const text = `Hello ${name},\n\nA new exam "${examName}" has been assigned. Duration: ${duration} minutes. Log in to take the test: ${examUrl}`;

  return sendEmail({ to: email, subject, text, html });
}

/**
 * 4. Sends a password reset credentials email.
 */
export async function sendPasswordResetEmail({ name, email, password, loginUrl }) {
  const subject = "Your Account Password Has Been Reset";
  const title = "Credentials Reset Success";
  const previewText = "Your temporary login credentials are listed below";

  const bodyHtml = `
    <p>Hello <strong>${name}</strong>,</p>
    <p>An administrator has successfully reset your account credentials. You can now access your account with the following credentials:</p>
    
    <div class="card">
      <h4>New Temporary Credentials</h4>
      <div class="card-row">
        <span class="card-label">LOGIN EMAIL</span>
        <span class="card-value">${email}</span>
      </div>
      <div class="card-row">
        <span class="card-label">NEW PASSWORD</span>
        <span class="card-code">${password}</span>
      </div>
    </div>
    
    <p>For security, please make sure to update this temporary password inside your Profile settings as soon as you log in.</p>
    
    <div class="btn-container">
      <a href="${loginUrl}" class="btn">Sign In to Account</a>
    </div>
  `;

  const html = emailWrapper({ title, headerEmoji: "🔑", previewText, bodyHtml });
  const text = `Hello ${name},\n\nYour password has been reset by the Admin.\n\nCredentials:\nEmail: ${email}\nNew Password: ${password}\n\nLogin URL: ${loginUrl}`;

  return sendEmail({ to: email, subject, text, html });
}

/**
 * 5. Sends result details to a student upon completing an exam.
 */
export async function sendResultAvailableEmail({ name, email, examName, score, totalQuestions, accuracy, passed, resultUrl }) {
  const subject = `Exam Result Declared: ${examName}`;
  const title = passed ? "Congratulations, You Passed!" : "Assessment Result Declared";
  const previewText = passed ? "Excellent effort, you met the passing threshold" : "Review your accuracy and subject gaps";

  const statusColor = passed ? "#10b981" : "#ef4444";
  const statusLabel = passed ? "PASSED" : "FAILED";

  const bodyHtml = `
    <p>Hello <strong>${name}</strong>,</p>
    <p>Your examination script has been graded. Below is a summary of your performance metrics:</p>
    
    <div class="card" style="border-left: 4px solid ${statusColor};">
      <h4>Scorecard Summary</h4>
      <div class="card-row" style="margin-bottom: 16px;">
        <span class="card-label">EXAMINATION TITLE</span>
        <span class="card-value" style="font-family: inherit; font-weight: bold;">${examName}</span>
      </div>
      <div style="display: flex; gap: 20px; flex-wrap: wrap;">
        <div style="flex: 1; min-width: 100px;">
          <span class="card-label">FINAL SCORE</span>
          <span class="card-value" style="font-weight: bold; font-size: 16px;">${score} / ${totalQuestions}</span>
        </div>
        <div style="flex: 1; min-width: 100px;">
          <span class="card-label">ACCURACY RATE</span>
          <span class="card-value" style="font-weight: bold; font-size: 16px; color: #0284c7;">${accuracy}%</span>
        </div>
        <div style="flex: 1; min-width: 100px;">
          <span class="card-label">STATUS</span>
          <span class="card-value" style="font-weight: bold; font-size: 16px; color: ${statusColor};">${statusLabel}</span>
        </div>
      </div>
    </div>
    
    <p>You can review detailed rationales, clinical explanations, and weak topics analytics inside your student profile dashboard.</p>
    
    <div class="btn-container">
      <a href="${resultUrl}" class="btn">View Detailed Review</a>
    </div>
  `;

  const html = emailWrapper({ title, headerEmoji: passed ? "🏆" : "📊", previewText, bodyHtml });
  const text = `Hello ${name},\n\nYour result for ${examName} is available.\nScore: ${score}/${totalQuestions}, Accuracy: ${accuracy}%, Passed: ${passed ? "Yes" : "No"}.\nReview here: ${resultUrl}`;

  return sendEmail({ to: email, subject, text, html });
}

/**
 * Sends an email notification to the administrator upon student completing an exam.
 */
export async function sendExamCompletionAdminEmail({
  studentName,
  studentEmail,
  examName,
  score,
  totalQuestions,
  accuracy,
  timeTaken,
  passed,
  warnings,
}) {
  const receiver = process.env.BREVO_RECIEVER_EMAIL || process.env.BREVO_RECEIVER_EMAIL || senderEmail;
  const subject = `Exam Finished: ${studentName} completed ${examName}`;
  const title = "Assessment Completed Alert";
  const previewText = `${studentName} has finished taking the exam`;

  const bodyHtml = `
    <p>Dear Administrator,</p>
    <p>A candidate has submitted their answer script. Below are their graded metrics:</p>
    
    <div class="card" style="background-color: #f8fafc; border: 1px solid #e2e8f0;">
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <tr>
          <td style="padding: 6px 0; color: #64748b; font-weight: 600; width: 40%;">STUDENT NAME</td>
          <td style="padding: 6px 0; color: #0f172a; font-weight: bold;">${studentName}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748b; font-weight: 600;">EMAIL</td>
          <td style="padding: 6px 0; color: #0f172a; font-family: monospace;">${studentEmail}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748b; font-weight: 600;">EXAM NAME</td>
          <td style="padding: 6px 0; color: #0284c7; font-weight: bold;">${examName}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748b; font-weight: 600;">SCORE</td>
          <td style="padding: 6px 0; color: #0f172a; font-weight: bold;">${score} / ${totalQuestions}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748b; font-weight: 600;">ACCURACY</td>
          <td style="padding: 6px 0; color: #0f172a;">${accuracy}%</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748b; font-weight: 600;">TIME ELAPSED</td>
          <td style="padding: 6px 0; color: #0f172a;">${Math.round(timeTaken / 60)} Minutes</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748b; font-weight: 600;">PASSING RESULT</td>
          <td style="padding: 6px 0; font-weight: bold; color: ${passed ? "#10b981" : "#ef4444"};">
            ${passed ? "PASSED" : "FAILED"}
          </td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748b; font-weight: 600;">SECURITY WARNINGS</td>
          <td style="padding: 6px 0; font-weight: bold; color: ${warnings > 0 ? '#ef4444' : '#1e293b'};">
            ${warnings} warning(s) logged
          </td>
        </tr>
      </table>
    </div>
  `;

  const html = emailWrapper({ title, headerEmoji: "📊", previewText, bodyHtml });
  const text = `Dear Admin,\n\nStudent ${studentName} completed ${examName}.\nScore: ${score}/${totalQuestions}, Accuracy: ${accuracy}%, Passed: ${passed ? "Yes" : "No"}, Warnings: ${warnings}.`;

  return sendEmail({ to: receiver, subject, text, html });
}
