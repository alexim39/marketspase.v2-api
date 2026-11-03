export const userWithdrawalEmailTemplate = (partner, request) => `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">

    <header style="text-align: center; padding: 10px; background-color: #f4f4f4;">
      <span style="font-family: sans-serif; font-size: 20px; font-weight: bold; color: #0e0d17;">Diamond Project Online</span>
    </header>

    <main style="padding: 20px;">
      <h2>Withdrawal Request Notification</h2>

      <p>Hi <strong>${partner.name.toUpperCase()}</strong>,</p>

      <p>
        We have received your request for a cash withdrawal of ${request.amount} into your ${request.bank} bank with number ${request.accountNumber}. Our team is currently reviewing it and will process it shortly.
      </p>

      <p>
        If you have any questions or need further assistance, please feel free to reach out to us at contacts@c21fg.online
      </p>

      <p>
        Thank you for your partnership!
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
        <a href="https://c21fg.online/" style="padding: 10px 20px; background-color: #28A745; color: white; text-decoration: none; border-radius: 5px; text-align: center; margin: 1em 0;">Go to Partners Platform</a>
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
