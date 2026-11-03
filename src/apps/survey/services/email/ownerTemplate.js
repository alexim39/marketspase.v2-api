export const ownerEmailTemplate = (surveyData) => {
  const capitalize = (str) =>
    str ? str.charAt(0).toUpperCase() + str.slice(1).toLowerCase() : "";

  const name = capitalize(surveyData.name);
  const surname = capitalize(surveyData.surname);
  const socials = Array.isArray(surveyData.socialMedia) ? surveyData.socialMedia.join(', ') : (surveyData.socialMedia ?? '');
  const pagePath = surveyData.username && surveyData.username !== 'business' ? `/${surveyData.username}` : '/';

  return `
  <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 0 10px rgba(0, 0, 0, 0.05);">
    <header style="background-color: #f4f4f4; padding: 20px; text-align: center;">
      <h1 style="margin: 0; font-size: 24px; color: #0e0d17;">Diamond Project Online</h1>
    </header>

    <main style="padding: 24px; color: #333;">
      <p style="font-size: 16px; margin-bottom: 16px;">
        Hi Partner,
      </p>

      <p style="font-size: 16px; line-height: 1.6;">
        A prospect named <strong>${name} ${surname}</strong> just visited the Diamond Project Online website and submitted contact details.
      </p>

      <p style="font-size: 16px; line-height: 1.6;">You may need to sign into the application platform to move this prospect into your contact list for further engagement.</p>

      <h4 style="font-size: 18px; color: #0e0d17; margin-top: 30px;">Prospect Information</h4>
      <table style="width: 100%; font-size: 16px; margin-top: 10px;">
        <tr>
          <td style="padding: 8px 0;"><strong>Name:</strong></td>
          <td style="padding: 8px 0;">${name}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0;"><strong>Surname:</strong></td>
          <td style="padding: 8px 0;">${surname}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0;"><strong>Phone:</strong></td>
          <td style="padding: 8px 0;">${surveyData.phoneNumber ?? ''}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0;"><strong>Email:</strong></td>
          <td style="padding: 8px 0;">${surveyData.email ?? ''}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0;"><strong>Age range:</strong></td>
          <td style="padding: 8px 0;">${surveyData.ageRange ?? ''}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0;"><strong>Social media:</strong></td>
          <td style="padding: 8px 0;">${socials}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0;"><strong>Employment:</strong></td>
          <td style="padding: 8px 0;">${surveyData.employedStatus ?? ''}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0;"><strong>Passive income importance:</strong></td>
          <td style="padding: 8px 0;">${surveyData.importanceOfPassiveIncome ?? ''}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0;"><strong>Online purchase habit:</strong></td>
          <td style="padding: 8px 0;">${surveyData.onlinePurchaseSchedule ?? ''}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0;"><strong>Motivation:</strong></td>
          <td style="padding: 8px 0;">${surveyData.primaryOnlineBusinessMotivation ?? ''}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0;"><strong>Tech comfort:</strong></td>
          <td style="padding: 8px 0;">${surveyData.comfortWithTech ?? ''}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0;"><strong>Weekly hours:</strong></td>
          <td style="padding: 8px 0;">${surveyData.onlineBusinessTimeDedication ?? ''}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0;"><strong>Heard via:</strong></td>
          <td style="padding: 8px 0;">${surveyData.referral ?? ''}${surveyData.referralCode ? ` (${surveyData.referralCode})` : ''}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0;"><strong>Country:</strong></td>
          <td style="padding: 8px 0;">${surveyData.country}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0;"><strong>State:</strong></td>
          <td style="padding: 8px 0;">${surveyData.state}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0;"><strong>Via page:</strong></td>
          <td style="padding: 8px 0;">${pagePath}</td>
        </tr>
      </table>

      <p style="font-size: 14px; line-height: 1.6;">Full answers are also in your dashboard: Prospects → My Page Leads → click the name. Accept with “Move to Contact” to work the lead in your pipeline.</p>

      <div style="text-align: center; margin: 30px 0;">
        <a href="https://c21fg.online/" 
           style="display: inline-block; padding: 12px 24px; background-color: #007BFF; color: #ffffff; text-decoration: none; border-radius: 5px; font-size: 16px;">
          Go to Partners Platform
        </a>
      </div>
    </main>

    <footer style="background-color: #f4f4f4; padding: 20px; text-align: center; font-size: 14px; color: #666;">
      Diamond Project: Becoming the ultimate version of yourself
    </footer>
  </div>
`;
};






export const partnerOwnerEmailTemplate = (surveyData) => `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">
    <header style="text-align: center; padding: 10px; background-color: #f4f4f4;">
      <span style="font-family: sans-serif; font-size: 20px; font-weight: bold; color: #0e0d17;">Diamond Project Online</span>
    </header>
    <main style="padding: 20px;">
      <h2>Partner Survey Submission</h2>
      <p>A partner named <strong>${surveyData.name.toUpperCase()} </strong> with phone number <strong>${surveyData.phoneNumber}</strong> just submitted the survey form from <a href="https://survey.c21fg.online">Diamond Project Online Survey</a>.</p>
      <p>This is just for your information</p>

      <h3>Prospect Contact Details</h3>

      <ul>
        <li><strong>Name: </strong> ${surveyData.name.toUpperCase()}</ol>
        <li><strong>Phone number: </strong> ${surveyData.phoneNumber}</li>
      </ul>

      <br>
      <div style="text-align: center;">
        <a href="https://c21fg.online/" style="padding: 10px 20px; background-color: #007BFF; color: white; text-decoration: none; border-radius: 5px; text-align: center; margin: 1em 0;">Go to Partners Platform</a>
      </div>
    </main>
    <br>
    <footer style="text-align: center; padding: 20px; background-color: #f4f4f4; margin-top: 20px;">
     <p>Diamond Project: Becoming the ultimate version of yourself  </p>
    </footer>
  </div>
`;