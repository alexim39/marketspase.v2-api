export const userWelcomeEmailTemplate = (surveyData) => {
    const capitalizeWords = (str) =>
    str
      ? str
          .split(' ')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
          .join(' ')
      : "";

  const name = capitalizeWords(surveyData.name);


  return `
  <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 0 10px rgba(0, 0, 0, 0.05);">
    <header style="background-color: #f4f4f4; padding: 20px; text-align: center;">
      <h1 style="margin: 0; font-size: 24px; color: #0e0d17;">Diamond Project Online</h1>
    </header>

    <main style="padding: 24px; color: #333;">
      <p style="font-size: 16px;">Hi ${name},</p>

      <p style="font-size: 16px; line-height: 1.6;">
        Thank you for taking the time to visit Diamond Project Online and completing our survey.
        We're excited to introduce you to a unique opportunity that could transform your life.
      </p>

      <p style="font-size: 16px; line-height: 1.6;">
        Diamond Project is more than just a project—it's your gateway to freedom in the digital world.
        We've combined the power of digital marketing with dynamic online partnership programs to create a system that empowers people like you.
      </p>

      <p style="font-size: 16px; line-height: 1.6; margin-bottom: 10px;">
        Here's what makes Diamond Project Online special:
      </p>

      <ul style="font-size: 16px; padding-left: 20px; line-height: 1.8;">
        <li><strong>Global Reach:</strong> Connect with partners worldwide, all from the comfort of your home.</li>
        <li><strong>Passive Income Potential:</strong> Build residual income streams that work for you 24/7.</li>
        <li><strong>Personal Branding:</strong> Establish your authority and grow your influence online.</li>
        <li><strong>Scalability:</strong> Expand your business without limits.</li>
        <li><strong>Expert Mentorship:</strong> Benefit from our comprehensive training programs and step-by-step guidance.</li>
      </ul>

      <p style="font-size: 16px; line-height: 1.6;">
        When you join us, you'll receive a personalized link and access to our advanced online platform, making it effortless to promote, manage, and grow your business.
      </p>

      <p style="font-size: 16px; line-height: 1.6;">
        If you have further questions, kindly reach out to us at 
        <a href="mailto:contacts@c21fg.online" style="color: #007BFF;">contacts@c21fg.online</a>
      </p>

      <p style="font-size: 16px; line-height: 1.6;">Let's build your digital legacy together!</p>

      <p style="font-size: 16px; line-height: 1.6;">
        Best regards,<br>
        Alex Imenwo<br>
        <strong>Diamond Project Online Team</strong>
      </p>
    </main>

    <footer style="background-color: #f4f4f4; padding: 20px; text-align: center; font-size: 14px; color: #666;">
      Diamond Project: Becoming the ultimate version of yourself
    </footer>
  </div>
`;
};
