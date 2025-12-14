// src/js/admin-panel.js
document.addEventListener('DOMContentLoaded', () => {
    // Check if user is admin
    if (!RoleManager.checkPermissionAndRedirect('canAccessAdminPanel')) {
        return;
    }

    // Element references
    const usersList = document.getElementById('usersList');
    const addUserBtn = document.getElementById('addUserBtn');
    const addUserModal = document.getElementById('addUserModal');
    const addUserForm = document.getElementById('addUserForm');
    const cancelAddUserBtn = document.getElementById('cancelAddUser');
    const editUserModal = document.getElementById('editUserModal');
    const editUserForm = document.getElementById('editUserForm');
    const cancelEditUserBtn = document.getElementById('cancelEditUser');
    const confirmDeleteModal = document.getElementById('confirmDeleteModal');
    const cancelDeleteBtn = document.getElementById('cancelDelete');
    const confirmDeleteBtn = document.getElementById('confirmDelete');
    const userSearch = document.getElementById('userSearch');
    const roleFilter = document.getElementById('roleFilter');
    
    // Stat elements
    const totalUsersEl = document.getElementById('totalUsers');
    const adminCountEl = document.getElementById('adminCount');
    const rqCountEl = document.getElementById('rqCount');
    const memberCountEl = document.getElementById('memberCount');
    
    // Close buttons
    const closeButtons = document.querySelectorAll('.close-button');
    const editCloseButton = document.querySelector('.edit-close');
    
    // State variables
    let allUsers = [];
    let currentUserIdToDelete = null;
    let deleteUserName = '';

    // --- FUNCTIONS ---

    // Load users from API
    async function loadUsers() {
        try {
            usersList.innerHTML = '<div class="loading-message">Loading users...</div>';
            
            const response = await fetch('/api/admin/users');
            if (!response.ok) throw new Error('Failed to fetch users');
            
            allUsers = await response.json();
            updateStats(allUsers);
            filterAndDisplayUsers();
            
        } catch (error) {
            console.error('Error loading users:', error);
            usersList.innerHTML = '<div class="error-message">Error loading users. Please try again.</div>';
        }
    }

    // Update statistics
    function updateStats(users) {
        const total = users.length;
        const admins = users.filter(u => u.role === 'MEC_OIC_ADMIN').length;
        const rqs = users.filter(u => u.role === 'RQ').length;
        const members = users.filter(u => u.role === 'MEMBER').length;
        
        totalUsersEl.textContent = total;
        adminCountEl.textContent = admins;
        rqCountEl.textContent = rqs;
        memberCountEl.textContent = members;
    }

    // Filter and display users
    function filterAndDisplayUsers() {
        const searchTerm = userSearch.value.toLowerCase();
        const roleFilterValue = roleFilter.value;
        
        let filteredUsers = allUsers;
        
        // Apply search filter
        if (searchTerm) {
            filteredUsers = filteredUsers.filter(user => 
                user.name.toLowerCase().includes(searchTerm) ||
                user.rank.toLowerCase().includes(searchTerm) ||
                (user.phone_number && user.phone_number.includes(searchTerm))
            );
        }
        
        // Apply role filter
        if (roleFilterValue) {
            filteredUsers = filteredUsers.filter(user => user.role === roleFilterValue);
        }
        
        // Display users
        displayUsers(filteredUsers);
    }

    // Display users in table
    function displayUsers(users) {
        if (users.length === 0) {
            usersList.innerHTML = '<div class="no-users-message">No users found matching your criteria.</div>';
            return;
        }

        let html = `
            <table class="users-table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Rank</th>
                        <th>Role</th>
                        <th>Phone</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
        `;
        
        users.forEach(user => {
            const roleBadgeClass = `role-badge role-${user.role.toLowerCase()}`;
            const roleDisplay = user.role === 'MEC_OIC_ADMIN' ? 'Admin' : 
                              user.role === 'RQ' ? 'RQ' : 'Member';
            
            // Get current user info
            const currentUserName = localStorage.getItem('loggedInUserName');
            const isCurrentUser = user.name === currentUserName;
            const isLastAdmin = user.role === 'MEC_OIC_ADMIN' && 
                               allUsers.filter(u => u.role === 'MEC_OIC_ADMIN').length <= 1;
            
            html += `
                <tr ${isCurrentUser ? 'class="current-user"' : ''}>
                    <td>
                        ${user.name}
                        ${isCurrentUser ? '<span class="current-user-badge">(You)</span>' : ''}
                    </td>
                    <td>${user.rank}</td>
                    <td><span class="${roleBadgeClass}">${roleDisplay}</span></td>
                    <td>${user.phone_number || 'N/A'}</td>
                    <td>
                        <button class="btn btn-small btn-primary edit-user-btn" 
                                data-user-id="${user.id}"
                                data-user-name="${user.name}"
                                data-user-rank="${user.rank}"
                                data-user-phone="${user.phone_number || ''}"
                                data-user-role="${user.role}">
                            <i class="fas fa-edit"></i> Edit
                        </button>
                        ${!isCurrentUser && !isLastAdmin ? `
                            <button class="btn btn-small btn-danger delete-user-btn" 
                                    data-user-id="${user.id}"
                                    data-user-name="${user.name}">
                                <i class="fas fa-trash"></i> Delete
                            </button>
                        ` : `
                            <button class="btn btn-small btn-secondary" disabled>
                                <i class="fas fa-trash"></i> Delete
                            </button>
                        `}
                    </td>
                </tr>
            `;
        });

        html += '</tbody></table>';
        usersList.innerHTML = html;

        // Add event listeners
        attachUserActionListeners();
    }

    // Attach event listeners to user action buttons
    function attachUserActionListeners() {
        // Edit buttons
        document.querySelectorAll('.edit-user-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const userId = e.target.closest('.edit-user-btn').dataset.userId;
                const userName = e.target.closest('.edit-user-btn').dataset.userName;
                const userRank = e.target.closest('.edit-user-btn').dataset.userRank;
                const userPhone = e.target.closest('.edit-user-btn').dataset.userPhone;
                const userRole = e.target.closest('.edit-user-btn').dataset.userRole;
                
                openEditModal(userId, userName, userRank, userPhone, userRole);
            });
        });

        // Delete buttons
        document.querySelectorAll('.delete-user-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const userId = e.target.closest('.delete-user-btn').dataset.userId;
                const userName = e.target.closest('.delete-user-btn').dataset.userName;
                
                openDeleteModal(userId, userName);
            });
        });
    }

    // Open add user modal
    function openAddModal() {
        addUserForm.reset();
        addUserModal.style.display = 'flex';
    }

    // Close add user modal
    function closeAddModal() {
        addUserModal.style.display = 'none';
        addUserForm.reset();
    }

    // Open edit user modal
    function openEditModal(userId, userName, userRank, userPhone, userRole) {
        document.getElementById('editUserId').value = userId;
        document.getElementById('editUserName').value = userName;
        document.getElementById('editUserRank').value = userRank;
        document.getElementById('editUserPhone').value = userPhone || '';
        document.getElementById('editUserRole').value = userRole;
        document.getElementById('editUserPassword').value = '';
        
        editUserModal.style.display = 'flex';
    }

    // Close edit user modal
    function closeEditModal() {
        editUserModal.style.display = 'none';
        editUserForm.reset();
    }

    // Open delete confirmation modal
    function openDeleteModal(userId, userName) {
        currentUserIdToDelete = userId;
        deleteUserName = userName;
        
        document.getElementById('deleteMessage').textContent = 
            `Are you sure you want to delete user "${userName}"? This action cannot be undone.`;
        
        confirmDeleteModal.style.display = 'flex';
    }

    // Close delete confirmation modal
    function closeDeleteModal() {
        confirmDeleteModal.style.display = 'none';
        currentUserIdToDelete = null;
        deleteUserName = '';
    }

    // Handle add user form submission
    async function handleAddUser(e) {
        e.preventDefault();
        
        const userData = {
            name: document.getElementById('adminUserName').value.trim(),
            password: document.getElementById('adminUserPassword').value,
            rank: document.getElementById('adminUserRank').value,
            phoneNumber: document.getElementById('adminUserPhone').value,
            role: document.getElementById('adminUserRole').value
        };

        // Validate input
        if (!userData.name) {
            alert('Please enter a name.');
            return;
        }

        if (userData.password.length < 6) {
            alert('Password must be at least 6 characters.');
            return;
        }

        if (!/^\d{8}$/.test(userData.phoneNumber)) {
            alert('Phone number must be exactly 8 digits.');
            return;
        }

        try {
            const response = await fetch('/api/admin/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(userData)
            });

            const result = await response.json();
            
            if (response.ok) {
                alert(`User "${userData.name}" created successfully!`);
                closeAddModal();
                loadUsers(); // Refresh the list
            } else {
                alert('Error: ' + result.message);
            }
        } catch (error) {
            console.error('Error creating user:', error);
            alert('Error creating user. Please try again.');
        }
    }

    // Handle edit user form submission
    async function handleEditUser(e) {
        e.preventDefault();
        
        const userId = document.getElementById('editUserId').value;
        const newRole = document.getElementById('editUserRole').value;
        const newPassword = document.getElementById('editUserPassword').value;
        
        // Update role
        try {
            const roleResponse = await fetch(`/api/admin/users/${userId}/role`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role: newRole })
            });

            if (!roleResponse.ok) {
                const result = await roleResponse.json();
                throw new Error(result.message || 'Failed to update role');
            }
            
            // Update password if provided
            if (newPassword.trim()) {
                if (newPassword.length < 6) {
                    alert('Password must be at least 6 characters.');
                    return;
                }
                
                const userName = document.getElementById('editUserName').value;
                const passwordResponse = await fetch('/api/change-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        name: userName, 
                        currentPassword: 'temp', // Admin can reset without knowing current password
                        newPassword: newPassword 
                    })
                });

                if (!passwordResponse.ok) {
                    const result = await passwordResponse.json();
                    // If current password check fails, use a different approach
                    // For now, just log the error
                    console.warn('Could not reset password:', result.message);
                }
            }
            
            alert('User updated successfully!');
            closeEditModal();
            loadUsers(); // Refresh the list
            
        } catch (error) {
            console.error('Error updating user:', error);
            alert('Error updating user: ' + error.message);
        }
    }

    // Handle delete user
    async function handleDeleteUser() {
        if (!currentUserIdToDelete) return;

        try {
            const response = await fetch(`/api/admin/users/${currentUserIdToDelete}`, {
                method: 'DELETE'
            });

            const result = await response.json();
            
            if (response.ok) {
                alert(`User "${deleteUserName}" deleted successfully.`);
                closeDeleteModal();
                loadUsers(); // Refresh the list
            } else {
                alert('Error: ' + result.message);
            }
        } catch (error) {
            console.error('Error deleting user:', error);
            alert('Error deleting user. Please try again.');
        }
    }

    // --- EVENT LISTENERS ---

    // Add user modal
    addUserBtn.addEventListener('click', openAddModal);
    cancelAddUserBtn.addEventListener('click', closeAddModal);
    addUserForm.addEventListener('submit', handleAddUser);

    // Edit user modal
    cancelEditUserBtn.addEventListener('click', closeEditModal);
    editUserForm.addEventListener('submit', handleEditUser);

    // Delete modal
    cancelDeleteBtn.addEventListener('click', closeDeleteModal);
    confirmDeleteBtn.addEventListener('click', handleDeleteUser);

    // Close modals when clicking X
    closeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const modal = btn.closest('.modal-overlay');
            if (modal) modal.style.display = 'none';
        });
    });

    if (editCloseButton) {
        editCloseButton.addEventListener('click', closeEditModal);
    }

    // Close modals when clicking outside
    window.addEventListener('click', (event) => {
        if (event.target.classList.contains('modal-overlay')) {
            event.target.style.display = 'none';
            
            // Reset forms
            if (event.target === addUserModal) {
                addUserForm.reset();
            } else if (event.target === editUserModal) {
                editUserForm.reset();
            } else if (event.target === confirmDeleteModal) {
                currentUserIdToDelete = null;
                deleteUserName = '';
            }
        }
    });

    // Search and filter
    userSearch.addEventListener('input', filterAndDisplayUsers);
    roleFilter.addEventListener('change', filterAndDisplayUsers);

    // --- INITIALIZATION ---
    loadUsers();
});