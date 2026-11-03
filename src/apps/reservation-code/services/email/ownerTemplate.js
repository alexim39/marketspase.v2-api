export const ownerEmailTemplate = (codeData) => `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">
    <header style="text-align: center; padding: 10px; background-color: #f4f4f4;">
      <span style="font-family: sans-serif; font-size: 20px; font-weight: bold; color: #0e0d17;">Diamond Project Online</span>
    </header>
    <main style="padding: 20px;">
      <h2>Activation Code Submission</h2>
      <p>A partner just submitted a new partner reservation code: ${codeData.code} for activation on the partners platform
      <p>You will need to validate reservation code and approve.</p>
      
      <br>
      <div style="text-align: center;">
        <a href="https://c21fg.online/" style="padding: 10px 20px; background-color: #007BFF; color: white; text-decoration: none; border-radius: 5px; text-align: center; margin: 1em 0;">Go to Partner Dashboard</a>
      </div>
    </main>
    <br>
    <footer style="text-align: center; padding: 20px; background-color: #f4f4f4; ; margin-top: 20px;"">
      <p>Follow us on:
        <a href="https://www.facebook.com/profile.php?id=61561933352527" style="margin: 0 5px;">Facebook</a> |
      </p>
      <p><a href="https://c21fg.online/legal/privacy">Privacy</a> | 
        <a href="https://c21fg.online/legal/terms">Terms</a> | 
      </p>
    </footer>
  </div>
`;
