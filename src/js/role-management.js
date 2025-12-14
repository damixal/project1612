// src/js/role-management.js
const RolePermissions = {
    MEC_OIC_ADMIN: {
        name: 'MEC OIC ADMIN',
        canManageUsers: true,
        canManageStores: true,
        canManageBoxes: true,
        canInitiateHOTO: true,
        canViewAllRecords: true,
        canDeleteStores: true,
        canDeleteBoxes: true,
        canChangeUserRoles: true,
        canAccessAdminPanel: true,
        canCreateStore: true,
        canEditStore: true,
        canRemoveBoxFromStore: true,
        canDeleteStore: true
    },
    MEMBER: {
        name: 'Member',
        canManageUsers: false,
        canManageStores: false,
        canManageBoxes: false,
        canInitiateHOTO: true,
        canViewAllRecords: false,
        canDeleteStores: false,
        canDeleteBoxes: false,
        canChangeUserRoles: false,
        canAccessAdminPanel: false,
        canCreateStore: false,
        canEditStore: false,
        canRemoveBoxFromStore: false,
        canDeleteStore: false
    },
    RQ: {
        name: 'RQ',
        canManageUsers: false,
        canManageStores: true,
        canManageBoxes: true,
        canInitiateHOTO: true,
        canViewAllRecords: true,
        canDeleteStores: false,
        canDeleteBoxes: false,
        canChangeUserRoles: false,
        canAccessAdminPanel: false,
        canCreateStore: true,
        canEditStore: true,
        canRemoveBoxFromStore: true,
        canDeleteStore: false
    }
};

class RoleManager {
    static getCurrentUserRole() {
        return localStorage.getItem('loggedInUserRole') || 'MEMBER';
    }

    static getCurrentUserPermissions() {
        const role = this.getCurrentUserRole();
        return RolePermissions[role] || RolePermissions.MEMBER;
    }

    static hasPermission(permission) {
        const permissions = this.getCurrentUserPermissions();
        return permissions[permission] || false;
    }

    static isAdmin() {
        return this.getCurrentUserRole() === 'MEC_OIC_ADMIN';
    }

    static isRQ() {
        return this.getCurrentUserRole() === 'RQ';
    }

    static isMember() {
        return this.getCurrentUserRole() === 'MEMBER';
    }

    static applyRoleBasedUI() {
        const role = this.getCurrentUserRole();
        const permissions = this.getCurrentUserPermissions();
        
        // Apply UI changes based on role
        this.hideUnauthorizedElements(permissions);
        this.updateUIForRole(role);
    }

    static hideUnauthorizedElements(permissions) {
        // Hide admin-only elements
        if (!permissions.canManageUsers) {
            document.querySelectorAll('.admin-only').forEach(el => {
                el.style.display = 'none';
            });
        }

        if (!permissions.canDeleteStores) {
            document.querySelectorAll('.delete-store-btn').forEach(el => {
                el.style.display = 'none';
            });
        }

        if (!permissions.canDeleteBoxes) {
            document.querySelectorAll('.delete-box-btn').forEach(el => {
                el.style.display = 'none';
            });
        }

        if (!permissions.canAccessAdminPanel) {
            document.querySelectorAll('.admin-panel-link').forEach(el => {
                el.style.display = 'none';
            });
        }

        if (!permissions.canCreateStore) {
            document.querySelectorAll('.create-store-btn').forEach(el => {
                el.style.display = 'none';
            });
        }

        if (!permissions.canRemoveBoxFromStore) {
            document.querySelectorAll('.remove-box-btn').forEach(el => {
                el.style.display = 'none';
            });
        }
    }

    static updateUIForRole(role) {
        // Update UI elements based on role
        const roleBadge = document.getElementById('userRoleBadge');
        if (roleBadge) {
            roleBadge.textContent = role.replace('_', ' ');
            roleBadge.className = `role-badge role-${role.toLowerCase()}`;
        }
    }

    static checkPermissionAndRedirect(permission, redirectUrl = 'home.html') {
        if (!this.hasPermission(permission)) {
            alert('Access denied. You do not have permission to access this page.');
            window.location.href = redirectUrl;
            return false;
        }
        return true;
    }

    static checkRoleAndRedirect(allowedRoles, redirectUrl = 'home.html') {
        const currentRole = this.getCurrentUserRole();
        if (!allowedRoles.includes(currentRole)) {
            alert('Access denied. This page requires different privileges.');
            window.location.href = redirectUrl;
            return false;
        }
        return true;
    }
}

// Initialize role-based UI on page load
document.addEventListener('DOMContentLoaded', () => {
    RoleManager.applyRoleBasedUI();
});

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { RolePermissions, RoleManager };
}