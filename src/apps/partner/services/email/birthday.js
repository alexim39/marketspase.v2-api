export const userBirthdayEmailTemplate = (partner) => `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">

    <header style="text-align: center; padding: 10px; background-color: #f4f4f4;">
      <span style="font-family: sans-serif; font-size: 20px; font-weight: bold; color: #0e0d17;">Diamond Project Online</span>
    </header>

    <main style="padding: 20px;">

      <p>Hi ${partner.name.toUpperCase()},</p>

      <p>
        Wishing you a very Happy Birthday from all of us at Diamond Project! 
      </p>

      <p>
      May your day be filled with joy, laughter, and everything that makes you smile. Thank you for being a part of our community — we’re lucky to have you!
      </p>

      <p>
      Enjoy your special day! 
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

    <br>
    <footer style="text-align: center; padding: 20px; background-color: #f4f4f4; margin-top: 20px;">
     <p>Diamond Project: Becoming the ultimate version of yourself  </p>
    </footer>
  </div>
`;
