export const ownerEmailTemplate = (userBooking) => {  
  // Create a new date object from the consultDate and add one day to it  
  const bookingDate = new Date(userBooking.consultDate);  
  bookingDate.setDate(bookingDate.getDate() + 1); // Add one day  

  // Format the date to a user-friendly format  
  const formattedDate = bookingDate.toLocaleDateString('en-US', {  
    year: 'numeric',  
    month: 'long',  
    day: 'numeric'  
  });  

  return `  
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">  
      <header style="text-align: center; padding: 10px; background-color: #f4f4f4;">  
        <span style="font-family: sans-serif; font-size: 20px; font-weight: bold; color: #0e0d17;">Diamond Project Online</span>  
      </header>  
      <main style="padding: 20px;">  
        <h2>Notification for One-on-One Booking Session</h2>  
        <p>A prospect named <strong>${userBooking.name.toUpperCase()} ${userBooking.surname.toUpperCase()}</strong> with phone number <strong>${userBooking.phone}</strong> has been booked for a one-on-one session.</p>  
        <p>You will need to be available at the scheduled date and time</p>  

        <h3>Booking Details</h3>  

        <ul>  
          <li><strong>Date: </strong> ${formattedDate}</li>  
          <li><strong>Time: </strong> ${userBooking.consultTime}</li>  
          <li><strong>Platform: </strong> ${userBooking.contactMethod}</li>  
          <li><strong>Purpose: </strong> ${userBooking.reason}</li>  
        </ul>  

        <br>  
        <div style="text-align: center;">  
          <a href="https://c21fg.online/" style="padding: 10px 20px; background-color: #007BFF; color: white; text-decoration: none; border-radius: 5px; text-align: center; margin: 1em 0;">Go to Partners Platform</a>  
        </div>  
      </main>  
      <br>  
      <footer style="text-align: center; padding: 20px; background-color: #f4f4f4; margin-top: 20px;">  
        <p>Follow us on:  
          <a href="https://www.facebook.com/profile.php?id=61561933352527" style="margin: 0 5px;">Facebook</a> |  
        </p>  
        <p><a href="https://c21fg.online/legal/privacy">Privacy</a> |   
          <a href="https://c21fg.online/legal/terms">Terms</a> |   
        </p>  
      </footer>  
    </div>  
  `;  
};