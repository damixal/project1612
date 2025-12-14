document.addEventListener('DOMContentLoaded', () => {
    // --- LOGIC FOR THE CREATE USER PAGE (ADMIN ONLY) ---
    const createUserForm = document.getElementById('createUserForm');
    if (createUserForm) {
        createUserForm.addEventListener('submit', async (event) => {
            event.preventDefault(); 
            
            const rank = document.getElementById('rank').value;
            const name = document.getElementById('name').value;
            const phoneNumber = document.getElementById('phoneNumber').value;
            const role = document.getElementById('role').value;
            const password = document.getElementById('password').value;
            const confirmPassword = document.getElementById('confirmPassword').value;

            // Validation for phone number
            if (phoneNumber.length !== 8 || !/^\d+$/.test(phoneNumber)) {
                alert('Phone number must be exactly 8 digits.');
                return;
            }
            
            // Validation for matching passwords
            if (password !== confirmPassword) {
                alert('Passwords do not match. Please try again.');
                return;
            }

            // Use admin endpoint instead of public endpoint
            const response = await fetch('/api/admin/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rank, name, password, phoneNumber, role })
            });
            
            const result = await response.json();
            
            if (response.ok) {
                // Clear form
                createUserForm.reset();
                alert('User created successfully!');
            } else {
                alert(result.message);
            }
        });
    }

    // --- LOGIC FOR THE LOGIN PAGE ---
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', async (event) => {
            event.preventDefault();

            const name = document.getElementById('name').value;
            const password = document.getElementById('password').value;

            const response = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, password })
            });

            const result = await response.json();
            
            if (response.ok) {
                localStorage.setItem('loggedInUserName', result.name);
                localStorage.setItem('loggedInUserRank', result.rank);
                localStorage.setItem('loggedInUserPhone', result.phoneNumber);
                localStorage.setItem('loggedInUserRole', result.role || 'MEMBER');
                localStorage.setItem('loggedInUserId', result.id);
                window.location.href = 'home.html'; 
            } else {
                alert(result.message);
            }
        });
    }
});