// src/js/hoto-form.js
document.addEventListener('DOMContentLoaded', () => {
    // Simple HOTO form for stores only
    const storeSelect = document.getElementById('storeSelect');
    const handoverBtn = document.getElementById('handoverBtn');
    const takeoverBtn = document.getElementById('takeoverBtn');
    const userInfo = document.getElementById('userInfo');
    
    // Display user info
    const userName = localStorage.getItem('loggedInUserName');
    const userRank = localStorage.getItem('loggedInUserRank');
    
    if (userInfo && userName && userRank) {
        userInfo.textContent = `${userRank} ${userName}`;
    }
    
    // Load stores for selection
    async function loadStores() {
        try {
            const response = await fetch('/api/stores');
            const stores = await response.json();
            
            // Filter to show only available stores or stores user can handover
            const userRole = localStorage.getItem('loggedInUserRole');
            const userId = localStorage.getItem('loggedInUserId');
            
            let availableStores = stores.filter(store => {
                if (store.status === 'AVAILABLE') return true;
                if (store.status === 'TAKEN_OVER' && store.current_holder_id == userId) return true;
                if (userRole === 'MEC_OIC_ADMIN') return true; // Admin can handover any store
                return false;
            });
            
            if (storeSelect) {
                storeSelect.innerHTML = '<option value="">Select a Store</option>';
                availableStores.forEach(store => {
                    const option = document.createElement('option');
                    option.value = store.id;
                    option.textContent = `${store.name} (${store.status})`;
                    storeSelect.appendChild(option);
                });
            }
        } catch (error) {
            console.error('Error loading stores:', error);
        }
    }
    
    // Handover a store
    if (handoverBtn) {
        handoverBtn.addEventListener('click', async () => {
            const storeId = storeSelect.value;
            if (!storeId) {
                alert('Please select a store first.');
                return;
            }
            
            const toUserId = prompt('Enter the User ID to handover to:');
            if (!toUserId) return;
            
            try {
                const response = await fetch(`/api/stores/${storeId}/handover`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        from_user_id: localStorage.getItem('loggedInUserId'),
                        to_user_id: toUserId,
                        remarks: 'Handed over via HOTO system'
                    })
                });
                
                const result = await response.json();
                alert(result.message);
                if (response.ok) {
                    loadStores(); // Refresh store list
                }
            } catch (error) {
                console.error('Error handing over store:', error);
                alert('Error handing over store');
            }
        });
    }
    
    // Takeover a store
    if (takeoverBtn) {
        takeoverBtn.addEventListener('click', async () => {
            const storeId = storeSelect.value;
            if (!storeId) {
                alert('Please select a store first.');
                return;
            }
            
            try {
                const response = await fetch(`/api/stores/${storeId}/takeover`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        user_id: localStorage.getItem('loggedInUserId'),
                        remarks: 'Taken over via HOTO system'
                    })
                });
                
                const result = await response.json();
                alert(result.message);
                if (response.ok) {
                    loadStores(); // Refresh store list
                }
            } catch (error) {
                console.error('Error taking over store:', error);
                alert('Error taking over store');
            }
        });
    }
    
    // Initial load
    loadStores();
});