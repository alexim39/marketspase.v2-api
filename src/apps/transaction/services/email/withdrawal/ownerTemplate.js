export const ownerEmailTemplate = (partner) => `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">
    <header style="text-align: center; padding: 10px; background-color: #f4f4f4;">
      <span style="font-family: sans-serif; font-size: 20px; font-weight: bold; color: #0e0d17;">Diamond Project Online</span>
    </header>
    <main style="padding: 20px;">
      <h2>Partner Withdrawal Request</h2>
      <p>A partner with name <strong>${partner.accountName}</strong> and account number <strong>${partner.accountNumber}</strong> just requested for a withdrawal from <a href="https://c21fg.online">Diamond Project Online</a>.</p>
      <p>You may need to quickly process request</p>
      <h2>Partner Details</h2>
      <p><strong>Name:</strong> ${partner.accountName}</p>
      <p><strong>Account Number:</strong> ${partner.accountNumber}</p>
      <p><strong>Bank:</strong> ${partner.bank}</p>
      <p><strong>Account:</strong> ${partner.amount}</p>
      <br>
      <div style="text-align: center;">
        <a href="https://c21fg.online/" style="padding: 10px 20px; background-color: #007BFF; color: white; text-decoration: none; border-radius: 5px; text-align: center; margin: 1em 0;">Go to Dashboard to Approve</a>
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
