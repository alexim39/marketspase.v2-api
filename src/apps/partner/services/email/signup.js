export const userWelcomeEmailTemplate = (newPartner) => `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">

    <header style="text-align: center; padding: 10px; background-color: #f4f4f4;">
      <span style="font-family: sans-serif; font-size: 20px; font-weight: bold; color: #0e0d17;">Diamond Project Online</span>
    </header>

    <main style="padding: 20px;">
      <h2>Welcome to Diamond Project Online Partners Platform – Your Journey Begins!</h2>

      <p>Hi <strong>${newPartner.name.toUpperCase()}</strong>,</p>

      <p>
        Welcome to the Diamond Project Online family! We’re excited to have you on board and look forward to supporting you on your journey toward financial success and personal growth.
      </p>

      <p>
      You’ve taken the first step toward creating a brighter future, and we’re here to guide you every step of the way. 
      Your personalized business link and access to our resources will empower you to start building your business right away!
      </p>

      <p>
      If you have any questions or need assistance, feel free to reach out—we’re here to help.
      </p>

      <p>
      Let's build your digital legacy together!
      </p>

      <p>
      Best regards,
      <br>
      Alex Imenwo
      <br>
      <strong>Diamond Project Online Team</strong>
      </p>

      <div style="text-align: center;">
        <a href="https://c21fg.online/" style="padding: 10px 20px; background-color: #007BFF; color: white; text-decoration: none; border-radius: 5px; text-align: center; margin: 1em 0;">Go to Partners Platform</a>
      </div>

    </main>

    <footer style="text-align: center; padding: 20px; background-color: #f4f4f4; margin-top: 20px;">
     <p>Follow us on:
        <a href="https://www.facebook.com/profile.php?id=61561933352527" style="margin: 0 5px;">Facebook</a> |
      </p>
      <p><a href="https://c21fg.online/legal/privacy">Privacy</a> | 
        <a href="https://c21fg.online/legal/terms">Terms</a> | 
        <a href="#">Unsubscribe</a>
      </p>
    </footer>
  </div>
`;
