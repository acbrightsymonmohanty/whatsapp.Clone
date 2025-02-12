// Initialize Firebase
const firebaseConfig = {
    apiKey: "AIzaSyDAXnVfPpJUv9mExO11pwRBAMX94Moa9ww",
    authDomain: "data-b828d.firebaseapp.com",
    databaseURL: "https://data-b828d-default-rtdb.firebaseio.com",
    projectId: "data-b828d",
    storageBucket: "data-b828d.firebasestorage.app",
    messagingSenderId: "996681924328",
    appId: "1:996681924328:web:f598b6e7b06b339118535d"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const database = firebase.database();
let currentUser = null;
let currentChat = null;
let userPresenceRef = null;
let activeChats = new Map();

// Add this function at the beginning of your script
function playNotificationSound() {
    const audio = document.getElementById('notification-sound');
    if (audio) {
        // Reset the audio to start
        audio.currentTime = 0;
        // Play the sound
        audio.play().catch(error => {
            console.log('Error playing sound:', error);
        });
    }
}

function shouldPlayNotification(message) {
    // Don't play for own messages
    if (message.senderId === currentUser.id) return false;
    
    // Always play if page is not visible
    if (document.visibilityState !== 'visible') return true;
    
    // If no chat is open, play the sound
    if (!currentChat) return true;
    
    // If message is from a different chat than the one currently open, play the sound
    const messageChat = [currentUser.id, message.senderId].sort().join('_');
    return messageChat !== currentChat.id;
}

class WhatsAppChat {
    constructor() {
        this.db = firebase.firestore();
        this.auth = firebase.auth();
        this.chatList = document.querySelector('.chat-list');
        this.searchInput = document.querySelector('.search-input');
        this.unsubscribeListeners = [];
        this.addHeaderWithLogout();
        this.init();
        this.searchFeature = new ChatSearch();
        this.chatManager = new ChatManager();
        this.setupUserListeners();
        this.mobileHandler = new MobileResponsive();
        
        // Add chat item click handler
        document.addEventListener('click', (e) => {
            const chatItem = e.target.closest('.chat-item');
            if (chatItem) {
                this.mobileHandler.showMainChat();
            }
        });
    }

    addHeaderWithLogout() {
        // Create header if it doesn't exist
        const headerHtml = `
            <div class="whatsapp-header">
                <div class="header-left">
                    <div class="user-profile">
                        <div class="user-avatar">
                            ${this.auth.currentUser?.email?.charAt(0).toUpperCase() || 'U'}
                        </div>
                        <div class="user-name">
                            ${this.auth.currentUser?.email || 'User'}
                        </div>
                    </div>
                </div>
                <div class="header-right">
                    <button class="logout-btn" title="Logout">
                        <i class="fas fa-sign-out-alt"></i>
                        Logout
                    </button>
                </div>
            </div>
        `;

        // Insert header at the top of the chat container
        const chatContainer = document.querySelector('.chat-container');
        chatContainer.insertAdjacentHTML('afterbegin', headerHtml);

        // Add logout click handler
        document.querySelector('.logout-btn').addEventListener('click', () => {
            this.handleLogout();
        });
    }
     
    async handleLogout() {
        try {
            const confirmed = await this.showLogoutConfirmation();
            
            if (confirmed) {
                // Show loading state
                const logoutBtn = document.querySelector('.logout-btn');
                logoutBtn.classList.add('loading');
                logoutBtn.disabled = true;

                // Update user status to offline
                await this.updateUserPresence(false);

                // Cleanup listeners
                this.cleanup();
                
                // Sign out from Firebase
                await this.auth.signOut();
                
                // Redirect to login page
                window.location.href = '/login.html';
            }
        } catch (error) {
            console.error('Logout error:', error);
            this.showError('Logout failed. Please try again.');
            
            // Reset button state
            const logoutBtn = document.querySelector('.logout-btn');
            logoutBtn.classList.remove('loading');
            logoutBtn.disabled = false;
        }
    }

    showLogoutConfirmation() {
        return new Promise((resolve) => {
            const dialogHtml = `
                <div class="logout-dialog">
                    <div class="logout-dialog-content">
                        <h3>Logout</h3>
                        <p>Are you sure you want to logout?</p>
                        <div class="logout-dialog-buttons">
                            <button class="cancel-button">Cancel</button>
                            <button class="confirm-button">Logout</button>
                        </div>
                    </div>
                </div>
            `;

            document.body.insertAdjacentHTML('beforeend', dialogHtml);
            const dialog = document.querySelector('.logout-dialog');

            // Add click handlers
            dialog.querySelector('.cancel-button').addEventListener('click', () => {
                dialog.remove();
                resolve(false);
            });

            dialog.querySelector('.confirm-button').addEventListener('click', () => {
                dialog.remove();
                resolve(true);
            });

            // Close on outside click
            dialog.addEventListener('click', (e) => {
                if (e.target === dialog) {
                    dialog.remove();
                    resolve(false);
                }
            });
        });
    }
    logoutUser() {
        // Show confirmation dialog
        if (confirm('Are you sure you want to logout?')) {
            // Show loading state
            document.body.classList.add('loading');
            
            // Sign out from Firebase
            firebase.auth().signOut().then(() => {
                // Clear any stored data
                localStorage.clear();
                sessionStorage.clear();
                
                // Hide app container and show login screen
                document.getElementById('app-container').style.display = 'none';
                document.getElementById('login-screen').style.display = 'flex';
                document.getElementById('profile-modal').style.display = 'none';
                
                // Reset form fields
                document.getElementById('login-email').value = '';
                document.getElementById('login-password').value = '';
            }).catch((error) => {
                console.error('Logout error:', error);
                alert('Logout failed. Please try again.');
            }).finally(() => {
                document.body.classList.remove('loading');
            });
        }
    }

    showError(message) {
        const errorToast = document.createElement('div');
        errorToast.className = 'error-toast';
        errorToast.textContent = message;
        
        document.body.appendChild(errorToast);
        
        setTimeout(() => {
            errorToast.remove();
        }, 3000);
    }

    init() {
        this.searchInput = document.querySelector('.search-container .input input');
        this.chatList = document.querySelector('#chatList');// Update the selector as per your DOM structure

    }

    setupRealtimeListeners() {
        // Listen for chat updates
        const chatListener = this.db.collection('chats')
            .orderBy('lastMessageTime', 'desc')
            .onSnapshot((snapshot) => {
                snapshot.docChanges().forEach(change => {
                    const chatData = change.doc.data();
                    const chatId = change.doc.id;

                    switch (change.type) {
                        case 'added':
                            this.handleNewChat(chatData, chatId);
                            break;
                        case 'modified':
                            this.handleChatUpdate(chatData, chatId);
                            break;
                        case 'removed':
                            this.handleChatRemoval(chatId);
                            break;
                    }
                });
            });

        // Listen for message updates
        const messageListener = this.db.collection('messages')
            .orderBy('timestamp', 'desc')
            .onSnapshot((snapshot) => {
                snapshot.docChanges().forEach(change => {
                    if (change.type === 'added' || change.type === 'modified') {
                        const messageData = change.doc.data();
                        this.updateLastMessage(messageData);
                    }
                });
            });

        this.unsubscribeListeners.push(chatListener, messageListener);
    }

    handleNewChat(chatData, chatId) {
        const existingChat = document.querySelector(`[data-chat-id="${chatId}"]`);
        if (!existingChat) {
            const chatElement = this.createChatElement(chatData, chatId);
            this.insertChatInOrder(chatElement, chatData.lastMessageTime);
        }
    }

    handleChatUpdate(chatData, chatId) {
        const existingChat = document.querySelector(`[data-chat-id="${chatId}"]`);
        if (existingChat) {
            const updatedChat = this.createChatElement(chatData, chatId);
            existingChat.replaceWith(updatedChat);
            this.insertChatInOrder(updatedChat, chatData.lastMessageTime);
        }
    }

    handleChatRemoval(chatId) {
        const chatElement = document.querySelector(`[data-chat-id="${chatId}"]`);
        if (chatElement) {
            chatElement.remove();
        }
    }

    updateLastMessage(messageData) {
        if (!messageData.chatId) return;

        const chatElement = document.querySelector(`[data-chat-id="${messageData.chatId}"]`);
        if (chatElement) {
            const lastMessageEl = chatElement.querySelector('.chat-last-message');
            const timeEl = chatElement.querySelector('.chat-time');

            if (lastMessageEl) {
                lastMessageEl.textContent = messageData.text;
            }
            if (timeEl && messageData.timestamp) {
                timeEl.textContent = this.formatTime(messageData.timestamp);
            }

            this.insertChatInOrder(chatElement, messageData.timestamp);
        }
    }

    insertChatInOrder(chatElement, timestamp) {
        const chats = Array.from(this.chatList.children);
        let inserted = false;

        for (const chat of chats) {
            if (chat === chatElement) continue;
            
            const currentTimestamp = chat.dataset.timestamp;
            if (currentTimestamp && timestamp > currentTimestamp) {
                this.chatList.insertBefore(chatElement, chat);
                inserted = true;
                break;
            }
        }

        if (!inserted && chatElement.parentElement !== this.chatList) {
            this.chatList.appendChild(chatElement);
        }
    }

    

    setupSearchListener() {
        this.searchInput = document.querySelector('.search-container .input input');
        this.chatList = document.querySelector('#chatList');
        const searchButton = document.querySelector('.search-container .input i');
    
        this.searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.trim().toLowerCase();
            this.filterChats(searchTerm);
        });
    
        searchButton.addEventListener('click', () => {
            const searchTerm = this.searchInput.value.trim().toLowerCase();
            this.filterChats(searchTerm);
        });
    }
    
    filterChats(searchTerm) {
        const chatItems = this.chatList.querySelectorAll('.chat-item');
        let hasResults = false;
    
        chatItems.forEach(chatItem => {
            const nameElement = chatItem.querySelector('.chat-name, .user-name, h2, strong');
            if (!nameElement) return;
    
            const name = nameElement.textContent.toLowerCase();
            const matches = searchTerm === '' || name.includes(searchTerm);
    
            chatItem.style.display = matches ? 'flex' : 'none';
    
            if (matches) {
                this.highlightText(nameElement, searchTerm);
                hasResults = true;
            } else {
                this.removeHighlight(nameElement);
            }
        });
    
        this.toggleNoResults(!hasResults && searchTerm !== '');
    }
    
    highlightText(element, searchTerm) {
        if (!searchTerm) {
            element.innerHTML = element.textContent; // Reset to plain text
            return;
        }
    
        const text = element.textContent;
        const highlightedText = text.replace(
            new RegExp(`(${searchTerm})`, 'gi'),
            `<span class="highlight">$1</span>`
        );
    
        element.innerHTML = highlightedText; // Apply the highlight
    }
    
    removeHighlight(element) {
        element.innerHTML = element.textContent; // Reset to plain text
    }
    
    toggleNoResults(show) {
        let noResults = this.chatList.querySelector('.no-results');
        if (show) {
            if (!noResults) {
                noResults = document.createElement('div');
                noResults.className = 'no-results';
                noResults.innerHTML = `
                    <div class="no-results-content">
                        <i class="fas fa-search"></i>
                        <p>No matching users found</p>
                    </div>
                `;
                this.chatList.appendChild(noResults);
            }
        } else if (noResults) {
            noResults.remove();
        }
    }
    
    

    formatTime(timestamp) {
        if (!timestamp) return '';
        
        const date = timestamp.toDate();
        const now = new Date();
        const today = now.toDateString();
        const messageDate = date.toDateString();

        if (messageDate === today) {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }

    cleanup() {
        // Unsubscribe from all listeners
        this.unsubscribeListeners.forEach(unsubscribe => unsubscribe());
    }

    setupUserListeners() {
        // Listen for user presence changes
        firebase.database().ref('.info/connected').on('value', (snap) => {
            if (snap.val() === true && this.auth.currentUser) {
                this.updateUserPresence(true);
            }
        });

        // Listen for new users
        firebase.database().ref('users').on('child_added', (snapshot) => {
            const userData = snapshot.val();
            if (userData && userData.email !== this.auth.currentUser.email) {
                this.chatManager.addUserToChat(userData);
            }
        });

        // Listen for user removals
        firebase.database().ref('users').on('child_removed', (snapshot) => {
            const userData = snapshot.val();
            if (userData) {
                this.chatManager.removeUserFromChat(userData.email);
            }
        });
    }

    updateUserPresence(isOnline) {
        if (!this.auth.currentUser) return;

        const userStatusRef = firebase.database()
            .ref(`users/${this.auth.currentUser.uid}/status`);
        
        userStatusRef.set(isOnline);

        if (isOnline) {
            userStatusRef.onDisconnect().set(false);
        }
    }
}


// Initialize only once when DOM is loaded
let whatsAppInstance = null;
document.addEventListener('DOMContentLoaded', () => {
    if (!whatsAppInstance) {
        whatsAppInstance = new WhatsAppChat();
    }
});

// Register new user with email
function registerUser(event) {
    event.preventDefault();
    console.log('Registration started'); // Debug log
    
    const username = document.getElementById('reg-username').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;

    console.log('Registering with:', { username, email }); // Debug log

    // Ensure username and email are not empty
    if (!username || !email) {
        alert('Username and email are required.');
        return;
    }

    // Create user with email and password
    firebase.auth().createUserWithEmailAndPassword(email, password)
        .then((userCredential) => {
            console.log('User created in Auth:', userCredential); // Debug log
            const user = userCredential.user;
            
            // Create user data object
            const userData = {
                id: user.uid,
                username: username,
                email: email,
                createdAt: firebase.database.ServerValue.TIMESTAMP,
                status: 'online'
            };

            console.log('Saving user data:', userData); // Debug log

            // Save to Realtime Database
            return firebase.database().ref('users/' + user.uid).set(userData);
        })
        .then(() => {
            console.log('User data saved successfully'); // Debug log
            alert('Registration successful!');
        })
        .catch((error) => {
            console.error('Registration error:', error);
            alert('Registration failed: ' + error.message);
        });
}

// Update the loginUser function
function loginUser(event) {
    event.preventDefault();
    
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    // Show loading state
    const loginBtn = document.querySelector('#login-form button[type="submit"]');
    if (loginBtn) {
        loginBtn.disabled = true;
        loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Logging in...';
    }

    // First sign out any existing session
    auth.signOut().then(() => {
        // Then attempt to sign in
        return auth.signInWithEmailAndPassword(email, password);
    })
    .then((userCredential) => {
        // Set session flag
        sessionStorage.setItem('isNewLogin', 'true');
        
        // Update user status
        return database.ref('users/' + userCredential.user.uid).update({
            status: 'online',
            lastSeen: firebase.database.ServerValue.TIMESTAMP
        });
    })
    .then(() => {
        // Reload the page
        window.location.href = window.location.href.split('#')[0];
    })
    .catch((error) => {
        console.error('Login error:', error);
        alert('Login failed: ' + error.message);
        
        // Reset login button
        if (loginBtn) {
            loginBtn.disabled = false;
            loginBtn.innerHTML = 'Login';
        }
    });
}

// Update the auth state change listener
auth.onAuthStateChanged((user) => {
    const isNewLogin = sessionStorage.getItem('isNewLogin') === 'true';
    
    if (user) {
        // User is signed in
        console.log('User is signed in:', user);
        
        // Get user data
        database.ref('users/' + user.uid).once('value')
            .then((snapshot) => {
                currentUser = snapshot.val();
                
                // Clear any existing data and listeners
                cleanupBeforeLogin();
                
                // Update user status
                return database.ref('users/' + user.uid).update({
                    status: 'online',
                    lastSeen: firebase.database.ServerValue.TIMESTAMP
                });
            })
            .then(() => {
                // Initialize app
                showApp();
                setupPresence();
                loadUsers();
                updateProfileInfo();
                initializeChatSelection();
                
                // Clear login flag
                sessionStorage.removeItem('isNewLogin');
            })
            .catch((error) => {
                console.error('Error initializing app:', error);
                alert('Error initializing app. Please try again.');
            });
    } else {
        // User is signed out
        if (!isNewLogin) {
            cleanupBeforeLogin();
            currentUser = null;
            
            // Show login screen
            document.getElementById('register-screen').style.display = 'none';
            document.getElementById('login-screen').style.display = 'flex';
            document.getElementById('app-container').style.display = 'none';
        }
    }
});

// Update cleanupBeforeLogin function
function cleanupBeforeLogin() {
    // Remove all Firebase listeners
    firebase.database().ref('users').off();
    firebase.database().ref('messages').off();
    firebase.database().ref('.info/connected').off();
    
    // Clear all chat data
    const chatList = document.querySelector('.chat-list');
    if (chatList) chatList.innerHTML = '';
    
    const chatMessages = document.querySelector('.chat-messages');
    if (chatMessages) chatMessages.innerHTML = '';
    
    // Reset chat state
    currentChat = null;
    
    // Clear stored data (except session flag)
    const isNewLogin = sessionStorage.getItem('isNewLogin');
    localStorage.clear();
    sessionStorage.clear();
    if (isNewLogin) {
        sessionStorage.setItem('isNewLogin', isNewLogin);
    }
    
    // Reset UI elements
    const mainChat = document.querySelector('.main-chat');
    if (mainChat) {
        mainChat.classList.remove('active', 'chat-active');
    }
}

// Update showApp function
function showApp() {
    // Update display
    document.getElementById('register-screen').style.display = 'none';
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-container').style.display = 'flex';
    
    // Reset any existing chat views
    const mainChat = document.querySelector('.main-chat');
    if (mainChat) {
        mainChat.classList.remove('active', 'chat-active');
    }
    
    // Clear any existing messages
    const chatMessages = document.querySelector('.chat-messages');
    if (chatMessages) {
        chatMessages.innerHTML = '';
    }
}

// Update the signOut function to handle logout without refresh
function signOut() {
    // Show loading state
    const logoutBtn = document.querySelector('.logout-btn');
    if (logoutBtn) {
        logoutBtn.disabled = true;
        logoutBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Logging out...';
    }

    Promise.resolve()
        .then(() => {
            // First update user status to offline
            if (currentUser) {
                return firebase.database().ref(`users/${currentUser.id}`).update({
                    status: 'offline',
                    lastSeen: firebase.database.ServerValue.TIMESTAMP
                });
            }
        })
        .then(() => {
            // Clean up all listeners
            firebase.database().ref('users').off();
            firebase.database().ref('messages').off();
            
            // Clear any stored data
            localStorage.clear();
            sessionStorage.clear();
            
            // Clear current user and chat
            currentUser = null;
            currentChat = null;
            
            // Clear chat list
            const chatList = document.querySelector('.chat-list');
            if (chatList) {
                chatList.innerHTML = '';
            }
            
            // Sign out from Firebase
            return auth.signOut();
        })
        .then(() => {
            // Update UI without page refresh
            document.getElementById('app-container').style.display = 'none';
            document.getElementById('profile-modal').style.display = 'none';
            document.getElementById('login-screen').style.display = 'flex';
            document.getElementById('register-screen').style.display = 'none';
            
            // Reset form fields
            document.getElementById('login-email').value = '';
            document.getElementById('login-password').value = '';
            
            // Clear main chat area
            const mainChat = document.querySelector('.main-chat');
            if (mainChat) {
                mainChat.classList.remove('active');
                const messages = mainChat.querySelector('.chat-messages');
                if (messages) {
                    messages.innerHTML = '';
                }
            }
        })
        .catch((error) => {
            console.error("Error signing out:", error);
            alert('Error signing out. Please try again.');
        })
        .finally(() => {
            // Reset logout button
            if (logoutBtn) {
                logoutBtn.disabled = false;
                logoutBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i> Logout';
            }
        });
}

// Toggle between login and register screens
function toggleAuth(screen) {
    if (screen === 'login') {
        document.getElementById('register-screen').style.display = 'none';
        document.getElementById('login-screen').style.display = 'flex';
    } else {
        document.getElementById('register-screen').style.display = 'flex';
        document.getElementById('login-screen').style.display = 'none';
    }
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM Loaded');
    
    // Register form submission
    const registerForm = document.getElementById('register-form');
    registerForm.addEventListener('submit', (e) => {
        console.log('Register form submitted');
        registerUser(e);
    });

    // Login form submission
    const loginForm = document.getElementById('login-form');
    loginForm.addEventListener('submit', (e) => {
        console.log('Login form submitted');
        loginUser(e);
    });

    // Add profile image click handler
    const profileImg = document.querySelector('.user-img');
    if (profileImg) {
        profileImg.addEventListener('click', () => {
            // You can add profile edit functionality here
            console.log('Profile clicked');
        });
    }
});

// Load Users List
function loadUsers() {
    const usersList = document.querySelector('.chat-list');
    const searchInput = document.querySelector('.search-container input');
    if (!usersList || !searchInput) {
        console.error('Chat list or search input element not found');
        return;
    }

    // Reference to users in Firebase
    const usersRef = firebase.database().ref('users');

    // Keep track of user elements by ID
    const userElements = {};
    const usersData = {}; // Store user data for filtering

    // Function to update or create a user list item
    function updateUser(user) {
        const chatId = [currentUser.id, user.id].sort().join('_');

        // Check if user element already exists
        let userElement = userElements[user.id];
        if (!userElement) {
            // Create a new user element
            userElement = document.createElement('div');
            userElement.className = 'chat-item';
            userElement.setAttribute('data-id', user.id);
            usersList.appendChild(userElement);
            userElements[user.id] = userElement;
        }

        // Update last message, unread count, and status in real-time
        firebase.database().ref('messages').child(chatId).limitToLast(1).on('value', (snapshot) => {
            let lastMessage = '';
            let lastTime = '';
            let unreadCount = 0;

            snapshot.forEach((msgSnapshot) => {
                const msg = msgSnapshot.val();
                lastMessage = msg.text;
                lastTime = formatTime(msg.timestamp);
                if (!msg.read && msg.senderId !== currentUser.id) {
                    unreadCount++;
                }
            });

            // Update the user element
            userElement.innerHTML = `
                <div class="user-wrapper">
                    <div class="user-avatar">
                        <img src="${user.photoURL || `https://ui-avatars.com/api/?name=${user.username}&background=00a884&color=fff`}" 
                             alt="${user.username}">
                        <span class="status-indicator ${user.status === 'online' ? 'online' : 'offline'}"></span>
                    </div>
                    <div class="user-info">
                        <div class="user-info-top">
                            <span class="user-name">${user.username}</span>
                            <span class="last-time">${lastTime}</span>
                        </div>
                        <div class="user-info-bottom">
                            <span class="last-message">${lastMessage || 'Click to start chat'}</span>
                            ${unreadCount > 0 ? `<span class="unread-count">${unreadCount}</span>` : ''}
                        </div>
                    </div>
                </div>
            `;
        });

        // Add click event to open chat
        userElement.addEventListener('click', () => startChat(user));
    }

    // Listen for user additions
    usersRef.on('child_added', (snapshot) => {
        const user = snapshot.val();
        if (user.id !== currentUser.id) {
            usersData[user.id] = user; // Store user data for search
            updateUser(user);
        }
    });

    // Listen for user updates
    usersRef.on('child_changed', (snapshot) => {
        const user = snapshot.val();
        if (user.id !== currentUser.id) {
            usersData[user.id] = user; // Update user data for search
            updateUser(user);
        }
    });

    // Listen for user removals
    usersRef.on('child_removed', (snapshot) => {
        const user = snapshot.val();
        const userElement = userElements[user.id];
        if (userElement) {
            usersList.removeChild(userElement);
            delete userElements[user.id];
            delete usersData[user.id];
        }
    });

    // User List Search functionality
    searchInput.addEventListener('input', (event) => {
        const searchTerm = event.target.value.toLowerCase();
        Object.values(userElements).forEach((userElement) => {
            const userId = userElement.getAttribute('data-id');
            const user = usersData[userId];
            if (user.username.toLowerCase().includes(searchTerm)) {
                userElement.style.display = '';
            } else {
                userElement.style.display = 'none';
            }
        });
    });
}


// Helper function to format timestamps
function formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}


// Clean up function to remove listeners
function cleanupListeners() {
    firebase.database().ref('users').off();
    firebase.database().ref('messages').off();
}

// Start chat function with proper cleanup
function startChat(user) {
    // Clean up previous chat listeners
    if (currentChat) {
        firebase.database().ref(`messages/${currentChat.id}`).off();
    }

    currentChat = {
        id: [currentUser.id, user.id].sort().join('_'),
        user: user
    };

    // Update UI
    document.querySelector('.main-chat').classList.add('active');
    updateChatHeader(user);
    loadMessages(currentChat.id);
}

// Update chat header with real-time status
function updateChatHeader(user) {
    const chatHeader = document.querySelector('.chat-header .chat-info');
    
    const updateHeader = (userData) => {
        chatHeader.innerHTML = `
            <img class="chat-avatar" src="${userData.photoURL || `https://ui-avatars.com/api/?name=${userData.username}&background=00a884&color=fff`}" alt="Contact avatar">
            <div class="contact-info">
                <div class="contact-name">${userData.username}</div>
                <div class="contact-status">
                    ${userData.status === 'online' ? 'online' : formatLastSeen(userData.lastSeen)}
                </div>
            </div>
        `;
    };

    updateHeader(user);

    // Listen for status changes
    const statusRef = firebase.database().ref(`users/${user.id}`);
    statusRef.on('value', (snapshot) => {
        const updatedUser = snapshot.val();
        if (updatedUser) {
            updateHeader(updatedUser);
        }
    });
}

// Load messages without duplicates
function loadMessages(chatId) {
    const messagesDiv = document.getElementById('chat-messages');
    messagesDiv.innerHTML = '';

    firebase.database().ref(`messages/${chatId}`)
        .on('child_added', (snapshot) => {
            const message = snapshot.val();
            const messageId = snapshot.key;

            // Create message element
            const messageElement = createMessageElement(message, messageId);
            messagesDiv.appendChild(messageElement);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;

            // Play notification if needed
            if (shouldPlayNotification(message)) {
                playNotificationSound();
            }

            // Mark message as read if it's received and chat is open
            if (message.senderId !== currentUser.id && !message.read) {
                firebase.database().ref(`messages/${chatId}/${messageId}`).update({
                    read: true,
                    readAt: firebase.database.ServerValue.TIMESTAMP
                });
            }
        });

    // Listen for read status changes
    firebase.database().ref(`messages/${chatId}`)
        .on('child_changed', (snapshot) => {
            const message = snapshot.val();
            const messageElement = document.querySelector(`[data-message-id="${snapshot.key}"]`);
            if (messageElement) {
                updateMessageStatus(messageElement, message);
            }
        });
}

// Update message status display
function updateMessageStatus(messageElement, message) {
    const statusElement = messageElement.querySelector('.message-status');
    if (statusElement) {
        statusElement.innerHTML = getMessageStatusIcon(message);
    }
}

// Get status icon based on message state
function getMessageStatusIcon(message) {
    if (message.read) {
        return '<i class="fas fa-check-double" style="color: #53bdeb;"></i>';
    } else if (message.delivered) {
        return '<i class="fas fa-check-double" style="color: #8696a0;"></i>';
    }
    return '<i class="fas fa-check" style="color: #8696a0;"></i>';
}

// Create message element with proper status
function createMessageElement(message, messageId) {
    const div = document.createElement('div');
    const isSent = message.senderId === currentUser.id;
    div.className = `message ${isSent ? 'sent' : 'received'}`;
    div.setAttribute('data-message-id', messageId);

    // Function to detect if a string is a URL
    const isUrl = (text) => {
        const urlPattern = /https?:\/\/[\w\-._~:?#@!$&'()*+,;=%]+/g;
        return urlPattern.test(text);
    };

    // Function to detect if a string is a phone number
    const isPhoneNumber = (text) => {
        const phonePattern = /\+?\d{1,4}?[-.\s]?\(?\d{1,3}?\)?[-.\s]?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,9}/g; // Adjusted pattern for various phone formats including +91
        return phonePattern.test(text);
    };

    // Determine content type (URL, phone number, or plain text)
    let messageContent;
    if (isUrl(message.text)) {
        messageContent = `<a href="${message.text}" target="_blank" class="message-text" style="color: blue; text-decoration: none;">${message.text}</a>`;
    } else if (isPhoneNumber(message.text)) {
        const formattedNumber = message.text.replace(/\s+/g, ''); // Remove spaces for consistency
        messageContent = `<a href="tel:${formattedNumber}" class="message-text" style="color: blue; text-decoration: none;">${message.text}</a>`;
    } else {
        messageContent = `<p class="message-text">${message.text}</p>`;
    }

    div.innerHTML = `
        <div class="message-content">
            ${messageContent}
            <div class="message-info">
                <span class="time">${formatTime(message.timestamp)}</span>
                ${isSent ? `
                    <span class="message-status">
                        ${getMessageStatusIcon(message)}
                    </span>
                ` : ''}
            </div>
        </div>
    `;

    return div;
}



// Add visibility change handler
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && currentChat) {
        // Mark all unread messages as read when chat is visible
        firebase.database().ref(`messages/${currentChat.id}`)
            .orderByChild('read')
            .equalTo(false)
            .once('value', (snapshot) => {
                snapshot.forEach((childSnapshot) => {
                    const message = childSnapshot.val();
                    if (message.senderId !== currentUser.id) {
                        childSnapshot.ref.update({
                            read: true,
                            readAt: firebase.database.ServerValue.TIMESTAMP
                        });
                    }
                });
            });
    }
});

// Send message with status tracking
function sendMessage() {
    if (!currentChat) return;

    const messageInput = document.getElementById('message-input');
    const message = messageInput.value.trim();
    
    if (!message) return;

    const messageData = {
        text: message,
        senderId: currentUser.id,
        timestamp: firebase.database.ServerValue.TIMESTAMP,
        status: 'sent',
        read: false,
        delivered: false
    };

    messageInput.value = '';

    const chatId = currentChat.id;
    firebase.database().ref('messages').child(chatId)
        .push(messageData)
        .then(() => {
            messageInput.focus();
            updateLastMessage(chatId, messageData);
            scrollToBottom();
        })
        .catch((error) => {
            console.error('Error sending message:', error);
            //alert('Failed to send message. Please try again.');
        });
}

// Update emoji picker initialization
function initializeEmojiPicker() {
    const emojiButton = document.querySelector('.emoji-button');
    const messageInput = document.getElementById('message-input');
    const chatInput = document.querySelector('.chat-input');

    // Create emoji picker container
    const emojiPicker = document.createElement('div');
    emojiPicker.className = 'emoji-picker';
    emojiPicker.style.display = 'none';

    // Create emoji categories
    const categories = {
        'Smileys': ["😀","😃","😄","😁","😆","😅","😂","🤣","😊","😇","🙂","🙃","😉","😌","😍","😘","😗","😙","😚","😋","😛","😝","😜","🤪","🤨","🧐","🤓","😎","🤩","😏","😒","😞","😔","😟","😕","🙁","☹️","😣","😖","😫","😩","🥺","😢","😭","😤","😠","😡","🤬","🤯","😳","🥵","🥶","😱","😨","😰","😥","😓","🤗","🤔","🤭","🤫","🤥","😶","😐","😑","😬","🙄","😯","😦","😧","😮","😲","🥱","😴","🤤","😪","😵","🤐","🥴","🤢","🤮","🤧","😷","🤒","🤕","🤑","🤠"],
    
        'Animals': ["🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯","🦁","🐮","🐷","🐽","🐸","🐵","🙈","🙉","🙊","🐒","🐔","🐧","🐦","🐤","🐣","🐥","🦆","🦅","🦉","🦇","🐺","🐗","🐴","🦄","🐝","🐛","🦋","🐌","🐞","🐜","🦟","🦗","🕷","🕸","🦂","🐢","🐍","🦎","🦖","🦕","🐙","🦑","🦐","🦞","🦀","🐡","🐠","🐟","🐬","🐳","🐋","🦈","🐊","🐅","🐆","🦓","🦍","🦧","🐘","🦛","🦏","🐪","🐫","🦒","🦘","🐃","🐂","🐄","🐎","🐖","🐏","🐑","🦙","🐐","🦌","🐕","🐩","🦮","🐕‍🦺","🐈","🐓","🦃","🦚","🦜","🦢","🦩","🕊","🐇","🦝","🦨","🦡","🦦","🦥","🐁","🐀","🐿","🦔"],
    
        'Food': ["🍏","🍎","🍐","🍊","🍋","🍌","🍉","🍇","🍓","🍈","🍒","🍑","🥭","🍍","🥥","🥝","🍅","🍆","🥑","🥦","🥬","🥒","🌶","🌽","🥕","🧄","🧅","🥔","🍠","🥐","🥯","🍞","🥖","🥨","🧀","🥚","🍳","🧈","🥞","🧇","🥓","🥩","🍗","🍖","🦴","🌭","🍔","🍟","🍕","🥪","🥙","🧆","🌮","🌯","🥗","🥘","🥫","🍝","🍜","🍲","🍛","🍣","🍱","🥟","🦪","🍤","🍙","🍚","🍘","🍥","🥠","🥮","🍢","🍡","🍧","🍨","🍦","🥧","🧁","🍰","🎂","🍮","🍭","🍬","🍫","🍿","🍩","🍪","🌰","🥜","🍯","🥛","🍼","☕️","🍵","🧃","🥤","🍶","🍺","🍻","🥂","🍷","🥃","🍸","🍹","🧉","🍾","🧊"],
    
        'Activities': ["⚽️","🏀","🏈","⚾️","🥎","🎾","🏐","🏉","🥏","🎱","🪀","🏓","🏸","🏒","🏑","🥍","🏏","🥅","⛳️","🪁‍♀️","🚣","🧗‍♀️","🧗","🚵‍♀️","🚵","🚴‍♀️","🚴","🏆","🥇","🥈","🥉","🏅","🎖","🏵","🎗","🎫","🎟","🎪","🤹","🤹‍♂️","🎭","🩰","🎨","🎬","🎤","🎧","🎼","🎹","🥁","🎷","🎺","🎸","🪕","🎻","🎲","♟","🎯","🎳","🎮","🎰","🧩"],
    
        'Travel': ["🚗","🚕","🚙","🚌","🚎","🏎","🚓","🚑","🚒","🚐","🚚","🚛","🚜","🦯","🦽","🦼","🛴","🚲","🛵","🏍","🛺","🚨","🚔","🚍","🚘","🚖","🚡","🚠","🚟","🚃","🚋","🚞","🚝","🚄","🚅","🚈","🚂","🚆","🚇","🚊","🚉","✈️","🛫","🛬","🛩","💺","🛰","🚀","🛸","🚁","🛶","⛵️","🚤","🛥","🛳","⛴","🚢","⚓️","⛽️","🚧","🚦","🚥","🚏","🗺","🗿","🗽","🗼","🏰","🏯","🏟","🎡","🎢","🎠","⛲️","⛱","🏖","🏝","🏜","🌋","⛰","🏔","🗻","🏕","⛺️","🏠","🏡","🏘","🏚","🏗","🏭","🏢","🏬","🏣","🏤","🏥","🏦","🏨","🏪","🏫","🏩","💒","🏛","⛪️","🕌","🕍","🛕","🕋","⛩","🛤","🛣","🗾","🎑","🏞","🌅","🌄","🌠","🎇","🎆","🌇","🌆","🏙","🌃","🌌","🌉","🌁"],
    
        'Objects': ["⌚️","📱","📲","💻","⌨️","🖥","🖨","🖱","🖲","🕹","🗜","💽","💾","💿","📀","📼","📷","📸","📹","🎥","📽","🎞","📞","☎️","📟","📠","📺","📻","🎙","🎚","🎛","🧭","⏱","⏲","⏰","🕰","⌛️","⏳","📡","🔋","🔌","💡","🔦","🕯","🪔","🧯","🛢","💸","💵","💴","💶","💷","💰","💳","💎","⚖️","🧰","🔧","🔨","⚒","🛠","⛏","🔩","⚙️","🧱","⛓","🧲","🔫","💣","🧨","🪓","🔪","🗡","⚔️","🛡","🚬","⚰️","⚱️","🏺","🔮","📿","🧿","💈","⚗️","🔭","🔬","🕳","🩹","🩺","💊","💉","🧬","🦠","🧫","🧪","🌡","🧹","🧺","🧻","🚽","🚰","🚿","🛁","🛀","🧼","🪒","🧽","🧴","🛎","🔑","🗝","🚪","🪑","🛋","🛏","🛌","🧸","🖼","🛍","🛒","🎁","🎈","🎏","🎀","🎊","🎉","🎎","🏮","🎐","🧧","✉️","📩","📨","📧","💌","📥","📤","📦","🏷","📪","📫","📬","📭","📮","📯","📜","📃","📄","📑","🧾","📊","📈","📉","🗒","🗓","📆","📅","🗑","📇","🗃","🗳","🗄","📋","📁","📂","🗂","🗞","📰","📓","📔","📒","📕","📗","📘","📙","📚","📖","🔖","🧷","🔗","📎","🖇","📐","📏","🧮","📌","📍","✂️","🖊","🖋","✒️","🖌","🖍","📝","✏️","🔍","🔎","🔏","🔐","🔒","🔓"],
    
        'Symbols': ["❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❣️","💕","💞","💓","💗","💖","💘","💝","💟","☮️","✝️","☪️","🕉","☸️","✡️","🔯","🕎","☯️","☦️","🛐","⛎","♈️","♉️","♊️","♋️","♌️","♍️","♎️","♏️","♐️","♑️","♒️","♓️","🆔","⚛️","🉑","☢️","☣️","📴","📳","🈶","🈚️","🈸","🈺","🈷️","✴️","🆚","💮","🉐","㊙️","㊗️","🈴","🈵","🈹","🈲","🅰️","🅱️","🆎","🆑","🅾️","🆘","❌","⭕️","🛑","⛔️","📛","🚫","💯","💢","♨️","🚷","🚯","🚳","🚱","🔞","📵","🚭","❗️","❕","❓","❔","‼️","⁉️","🔅","🔆","〽️","⚠️","🚸","🔱","⚜️","🔰","♻️","✅","🈯️","💹","❇️","✳️","❎","🌐","💠","Ⓜ️","🌀","💤","🏧","🚾","♿️","🅿️","🈳","🈂️","🛂","🛃","🛄","🛅","🚹","🚺","🚼","🚻","🚮","🎦","📶","🈁","🔣","ℹ️","🔤","🔡","🔠","🆖","🆗","🆙","🆒","🆕","🆓","0️⃣","1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟","🔢","#️⃣","*️⃣","⏏️","▶️","⏸","⏯","⏹","⏺","⏭","⏮","⏩","⏪","⏫","⏬","◀️","🔼","🔽","➡️","⬅️","⬆️","⬇️","↗️","↘️","↙️","↖️","↕️","↔️","↪️","↩️","⤴️","⤵️","🔀","🔁","🔂","🔄","🔃","🎵","🎶","➕","➖","➗","✖️","♾","💲","💱","™️","©️","®️","〰️","➰","➿","🔚","🔙","🔛","🔝","🔜","✔️","☑️","🔘","🔴","🟠","🟡","🟢","🔵","🟣","⚫️","⚪️","🟤","🔺","🔻","🔸","🔹","🔶","🔷","🔳","🔲","▪️","▫️","◾️","◽️","◼️","◻️","🟥","🟧","🟨","🟩","🟦","🟪","⬛️","⬜️","🟫","🔈","🔇","🔉","🔊","🔔","🔕","📣","📢","👁‍🗨","💬","💭","🗯","♠️","♣️","♥️","♦️","🃏","🎴","🀄️","🕐","🕑","🕒","🕓","🕔","🕕","🕖","🕗","🕘","🕙","🕚","🕛","🕜","🕝","🕞","🕟","🕠","🕡","🕢","🕣","🕤","🕥","🕦","🕧"]
    };

    // Create category tabs
    const categoryTabs = document.createElement('div');
    categoryTabs.className = 'emoji-categories';
    
    Object.keys(categories).forEach((category, index) => {
        const tab = document.createElement('button');
        tab.className = 'emoji-category-tab';
        tab.textContent = category;
        tab.onclick = () => showCategory(category);
        if (index === 0) tab.classList.add('active');
        categoryTabs.appendChild(tab);
    });

    emojiPicker.appendChild(categoryTabs);

    // Create emoji container
    const emojiContainer = document.createElement('div');
    emojiContainer.className = 'emoji-container';
    emojiPicker.appendChild(emojiContainer);

    function showCategory(category) {
        // Update active tab
        document.querySelectorAll('.emoji-category-tab').forEach(tab => {
            tab.classList.remove('active');
            if (tab.textContent === category) tab.classList.add('active');
        });

        // Show emojis
        emojiContainer.innerHTML = '';
        categories[category].forEach(emoji => {
            const emojiSpan = document.createElement('span');
            emojiSpan.className = 'emoji';
            emojiSpan.textContent = emoji;
            emojiSpan.onclick = () => {
                insertEmoji(emoji);
                toggleEmojiPicker();
            };
            emojiContainer.appendChild(emojiSpan);
        });
    }

    // Toggle emoji picker
    function toggleEmojiPicker() {
        const isVisible = emojiPicker.style.display === 'block';
        emojiPicker.style.display = isVisible ? 'none' : 'block';
        if (!isVisible) showCategory('Smileys'); // Show first category by default
    }

    // Insert emoji at cursor position
    function insertEmoji(emoji) {
        const start = messageInput.selectionStart;
        const end = messageInput.selectionEnd;
        const text = messageInput.value;
        const before = text.substring(0, start);
        const after = text.substring(end);
        messageInput.value = before + emoji + after;
        messageInput.selectionStart = messageInput.selectionEnd = start + emoji.length;
        messageInput.focus();
    }

    // Add click handlers
    emojiButton.onclick = toggleEmojiPicker;
    
    // Close emoji picker when clicking outside
    document.addEventListener('click', (e) => {
        if (!emojiPicker.contains(e.target) && !emojiButton.contains(e.target)) {
            emojiPicker.style.display = 'none';
        }
    });

    // Add emoji picker to chat input
    chatInput.appendChild(emojiPicker);

    // Show first category
    showCategory('Smileys');
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    initializeEmojiPicker();
});

// Mark messages as read when chat is opened
function markMessagesAsRead(chatId) {
    firebase.database().ref('messages').child(chatId)
        .orderByChild('senderId')
        .equalTo(currentChat.user.id)
        .once('value', (snapshot) => {
            snapshot.forEach((childSnapshot) => {
                const message = childSnapshot.val();
                if (!message.read) {
                    childSnapshot.ref.update({
                        read: true,
                        readAt: firebase.database.ServerValue.TIMESTAMP
                    });
                }
            });
        });
}

// Update chat status in header
function updateChatStatus(status) {
    const statusElement = document.querySelector('.contact-status');
    if (statusElement) {
        statusElement.textContent = status === 'online' ? 'online' : 
            formatLastSeen(currentChat.user.lastSeen);
    }
}

// Format time like WhatsApp
function formatTime(timestamp) {
    if (!timestamp) return '';
    
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    const oneDay = 24 * 60 * 60 * 1000;
    const oneWeek = 7 * oneDay;
    
    // Today: show time
    if (diff < oneDay && date.getDate() === now.getDate()) {
        return date.toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit',
            hour12: true 
        });
    }
    
    // Yesterday
    if (diff < 2 * oneDay && date.getDate() === now.getDate() - 1) {
        return 'Yesterday';
    }
    
    // Within week: show day name
    if (diff < oneWeek) {
        return date.toLocaleDateString('en-US', { weekday: 'short' });
    }
    
    // Older: show date
    return date.toLocaleDateString('en-US', { 
        month: 'short',
        day: 'numeric'
    });
}

// Format last seen
function formatLastSeen(timestamp) {
    if (!timestamp) return 'offline';
    
    const now = new Date();
    const lastSeen = new Date(timestamp);
    const diff = now - lastSeen;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    // Just now (within 1 minute)
    if (minutes < 1) {
        return 'last seen just now';
    }
    
    // Minutes
    if (minutes < 60) {
        return `last seen ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
    }
    
    // Hours
    if (hours < 24) {
        return `last seen ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
    }
    
    // Today
    if (lastSeen.toDateString() === now.toDateString()) {
        return `last seen today at ${lastSeen.toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit',
            hour12: true 
        })}`;
    }
    
    // Yesterday
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (lastSeen.toDateString() === yesterday.toDateString()) {
        return `last seen yesterday at ${lastSeen.toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit',
            hour12: true 
        })}`;
    }
    
    // More than 2 days ago
    return `last seen ${lastSeen.toLocaleDateString('en-US', { 
        month: 'short',
        day: 'numeric'
    })} at ${lastSeen.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        hour12: true 
    })}`;
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
    // Message input
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-button');

    // Enter key handler
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Click handler
    sendButton.addEventListener('click', (e) => {
        e.preventDefault();
        sendMessage();
    });

    // Mobile back button
    const backButton = document.querySelector('.back-button');
    if (backButton) {
        backButton.addEventListener('click', () => {
            document.querySelector('.main-chat').classList.remove('active');
        });
    }
});

// Update profile related functions
function updateProfileInfo() {
    if (currentUser) {
        const profileImage = document.getElementById('profile-image');
        if (currentUser.photoURL) {
            profileImage.src = currentUser.photoURL;
        } else {
            // Default avatar with user's initial
            profileImage.src = `https://ui-avatars.com/api/?name=${currentUser.username}&background=00a884&color=fff`;
        }
    }
}

// Handle profile image upload
async function handleProfileImageUpload(file) {
    if (!file) return;

    try {
        const storageRef = storage.ref();
        const fileRef = storageRef.child(`profile-images/${currentUser.id}/${Date.now()}_${file.name}`);
        
        // Upload file
        const snapshot = await fileRef.put(file);
        const downloadURL = await snapshot.ref.getDownloadURL();
        
        // Update user profile
        await firebase.database().ref('users/' + currentUser.id).update({
            photoURL: downloadURL
        });

        // Update current user object
        currentUser.photoURL = downloadURL;
        
        // Update UI
        document.getElementById('profile-image').src = downloadURL;
        document.getElementById('profile-preview').src = downloadURL;
        
        return downloadURL;
    } catch (error) {
        console.error('Error uploading profile image:', error);
        alert('Failed to upload image. Please try again.');
    }
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
    // Profile image upload handler
    const profileUpload = document.getElementById('profile-upload');
    if (profileUpload) {
        profileUpload.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                // Check file type
                if (!file.type.startsWith('image/')) {
                    alert('Please upload an image file');
                    return;
                }
                // Check file size (max 5MB)
                if (file.size > 5 * 1024 * 1024) {
                    alert('Image size should be less than 5MB');
                    return;
                }
                await handleProfileImageUpload(file);
            }
        });
    }

    // Profile icon click handler
    const profileIcon = document.querySelector('.profile-icon');
    if (profileIcon) {
        profileIcon.addEventListener('click', openProfileModal);
    }
});

// Modal functions
function openProfileModal() {
    const modal = document.getElementById('profile-modal');
    const profilePreview = document.getElementById('profile-preview');
    const editUsername = document.getElementById('edit-username');
    const editAbout = document.getElementById('edit-about');
    
    // Set current values
    if (currentUser.photoURL) {
        profilePreview.src = currentUser.photoURL;
    } else {
        profilePreview.src = `https://ui-avatars.com/api/?name=${currentUser.username}&background=00a884&color=fff`;
    }
    
    editUsername.value = currentUser.username || '';
    editAbout.value = currentUser.about || 'Hey there! I am using WhatsApp';
    
    modal.style.display = 'block';
    
    // Add slide animation class
    modal.querySelector('.modal-content').style.transform = 'translateX(0)';
}

function closeProfileModal() {
    const modal = document.getElementById('profile-modal');
    const modalContent = modal.querySelector('.modal-content');
    
    // Add slide out animation
    modalContent.style.transform = 'translateX(100%)';
    
    // Wait for animation to complete
    setTimeout(() => {
        modal.style.display = 'none';
        modalContent.style.transform = '';
    }, 300);
}

// Update profile function
async function updateProfile() {
    const username = document.getElementById('edit-username').value.trim();
    const about = document.getElementById('edit-about').value.trim();
    
    if (!username) {
        alert('Please enter a name');
        return;
    }

    try {
        await firebase.database().ref('users/' + currentUser.id).update({
            username: username,
            about: about
        });

        currentUser.username = username;
        currentUser.about = about;
        
        updateProfileInfo();
        closeProfileModal();
        
        // Show success message
        const toast = document.createElement('div');
        toast.className = 'toast-message';
        toast.textContent = 'Profile updated successfully';
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.remove();
        }, 30);
        
    } catch (error) {
        console.error('Error updating profile:', error);
        alert('Failed to update profile');
    }
}

// Add this CSS for toast messages
document.head.insertAdjacentHTML('beforeend', `
    <style>
        .toast-message {
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: #333;
            color: white;
            padding: 12px 24px;
            border-radius: 4px;
            z-index: 1001;
            animation: fadeInOut 3s ease-in-out;
        }
        
        @keyframes fadeInOut {
            0%, 100% { opacity: 0; }
            10%, 90% { opacity: 1; }
        }
    </style>
`);

// User presence handling
function setupPresence() {
    if (!currentUser) return;

    const userStatusRef = database.ref(`users/${currentUser.id}`);
    const connectedRef = database.ref('.info/connected');

    // Remove any existing listeners
    userStatusRef.off();
    connectedRef.off();

    // Set up new presence system
    connectedRef.on('value', (snap) => {
        if (snap.val() === true) {
            // User is connected
            userStatusRef.update({
                status: 'online',
                lastSeen: firebase.database.ServerValue.TIMESTAMP
            });

            // Set up disconnect handler
            userStatusRef.onDisconnect().update({
                status: 'offline',
                lastSeen: firebase.database.ServerValue.TIMESTAMP
            });
        }
    });

    // Handle visibility change
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            userStatusRef.update({
                status: 'online',
                lastSeen: firebase.database.ServerValue.TIMESTAMP
            });
        } else {
            userStatusRef.update({
                status: 'offline',
                lastSeen: firebase.database.ServerValue.TIMESTAMP
            });
        }
    });
}

// Update user status in UI
function updateUserStatusUI(userId, status, lastSeen) {
    const userElement = document.querySelector(`[data-user-id="${userId}"]`);
    if (!userElement) return;

    const statusElement = userElement.querySelector('.user-status');
    const statusIndicator = userElement.querySelector('.status-indicator');

    if (status === 'online') {
        statusElement.textContent = 'online';
        statusElement.style.color = '#00a884';
        statusIndicator?.classList.add('online');
        statusIndicator?.classList.remove('offline');
    } else {
        const lastSeenText = formatLastSeen(lastSeen);
        statusElement.textContent = lastSeenText;
        statusElement.style.color = '#667781';
        statusIndicator?.classList.add('offline');
        statusIndicator?.classList.remove('online');
    }
}

// Periodic status check and update
/*setInterval(() => {
    if (currentUser && document.visibilityState === 'visible') {
        firebase.database().ref(`users/${currentUser.id}`).update({
            status: 'online',
            lastSeen: firebase.database.ServerValue.TIMESTAMP
        });
    }
}, 10000);*/ // Update every 30 seconds

// Load chats with proper formatting and unread counts
function loadChats() {
    const chatsList = document.querySelector('.chats-list');
    const searchInput = document.querySelector('.search-input');
    let allChats = [];

    firebase.database().ref('chats').orderByChild('lastMessageTime')
        .on('value', (snapshot) => {
            allChats = [];
            snapshot.forEach((chat) => {
                if (chat.val().participants.includes(currentUser.id)) {
                    allChats.unshift({
                        id: chat.key,
                        ...chat.val()
                    });
                }
            });
            filterAndDisplayChats(allChats, searchInput.value);
        });

    // Search functionality
    searchInput.addEventListener('input', (e) => {
        filterAndDisplayChats(allChats, e.target.value);
    });
}

// Filter and display chats based on search
function filterAndDisplayChats(chats, searchTerm) {
    const chatsList = document.querySelector('.chats-list');
    chatsList.innerHTML = '';
    
    const filteredChats = chats.filter(chat => 
        chat.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (chat.lastMessage && chat.lastMessage.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    filteredChats.forEach(chat => {
        const chatElement = createChatListItem(chat);
        chatsList.appendChild(chatElement);
    });
}

// Create chat list item with proper formatting
function createChatListItem(chat) {
    // Create or find the container for the chat item
    const div = document.querySelector(`.chat-item[data-chat-id="${chat.id}"]`) || document.createElement('div');
    div.className = 'chat-item';
    div.setAttribute('data-chat-id', chat.id);

    const unreadCount = chat.unreadCount || 0;
    const isUnread = unreadCount > 0 && chat.lastMessageSender !== currentUser.id;

    // Update the content of the chat item
    div.innerHTML = `
        <div class="chat-avatar">
            <img src="${chat.photoURL || `https://ui-avatars.com/api/?name=${chat.name}`}" alt="">
        </div>
        <div class="chat-content">
            <div class="chat-header">
                <h2 class="chat-name ${isUnread ? 'unread' : ''}">${chat.name}</h2>
                <span class="chat-time ${isUnread ? 'unread' : ''}">${formatTime(chat.lastMessageTime)}</span>
            </div>
            <div class="chat-message-preview">
                <div class="message-content ${isUnread ? 'unread' : ''}">
                    ${chat.lastMessageSender === currentUser.id ? 
                        `<span class="message-status">${getStatusIcon(chat.lastMessageStatus)}</span>` : ''}
                    <span class="preview-text">${chat.lastMessage || ''}</span>
                </div>
                ${isUnread ? `
                    <div class="unread-badge">
                        <span>${unreadCount}</span>
                    </div>
                ` : ''}
            </div>
        </div>
    `;

    // Add click listener to handle chat selection and mark as read
    div.addEventListener('click', () => {
        selectChat(chat);
        markChatAsRead(chat.id);
    });

    return div;
}

// Function to update chat item in real-time
function updateChatListItem(chat) {
    const chatItem = document.querySelector(`.chat-item[data-chat-id="${chat.id}"]`);
    if (chatItem) {
        const unreadCount = chat.unreadCount || 0;
        const isUnread = unreadCount > 0 && chat.lastMessageSender !== currentUser.id;

        chatItem.querySelector('.chat-name').classList.toggle('unread', isUnread);
        chatItem.querySelector('.chat-time').classList.toggle('unread', isUnread);
        chatItem.querySelector('.chat-time').textContent = formatTime(chat.lastMessageTime);

        const messageContent = chatItem.querySelector('.message-content');
        if (messageContent) {
            messageContent.classList.toggle('unread', isUnread);
            messageContent.innerHTML = `
                ${chat.lastMessageSender === currentUser.id ? 
                    `<span class="message-status">${getStatusIcon(chat.lastMessageStatus)}</span>` : ''}
                <span class="preview-text">${chat.lastMessage || ''}</span>
            `;
        }

        const unreadBadge = chatItem.querySelector('.unread-badge');
        if (unreadBadge) {
            if (isUnread) {
                unreadBadge.querySelector('span').textContent = unreadCount;
            } else {
                unreadBadge.remove();
            }
        } else if (isUnread) {
            const badge = document.createElement('div');
            badge.className = 'unread-badge';
            badge.innerHTML = `<span>${unreadCount}</span>`;
            chatItem.querySelector('.chat-message-preview').appendChild(badge);
        }
    }
}


// Mark chat as read
function markChatAsRead(chatId) {
    firebase.database().ref(`chats/${chatId}`).update({
        unreadCount: 0
    });
}

// Format time like WhatsApp
function formatTime(timestamp) {
    if (!timestamp) return '';
    
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    const oneDay = 24 * 60 * 60 * 1000;
    
    if (diff < oneDay && date.getDate() === now.getDate()) {
        return date.toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit',
            hour12: true 
        });
    } else if (diff < 2 * oneDay && date.getDate() === now.getDate() - 1) {
        return 'Yesterday';
    } else if (diff < 7 * oneDay) {
        return date.toLocaleDateString('en-US', { weekday: 'short' });
    } else {
        return date.toLocaleDateString('en-US', { 
            day: '2-digit',
            month: '2-digit',
            year: '2-digit'
        });
    }
}

// Setup input area with attachments and emoji
function setupMessageInput() {
    const inputContainer = document.querySelector('.input-container');
    const messageInput = document.querySelector('.message-input');
    const emojiButton = document.querySelector('.emoji-button');
    const attachButton = document.querySelector('.attach-button');
    const attachMenu = document.querySelector('.attach-menu');

    // Initialize emoji picker
    const emojiPicker = new EmojiMart.Picker({
        onEmojiSelect: (emoji) => {
            const cursorPos = messageInput.selectionStart;
            const text = messageInput.value;
            messageInput.value = text.slice(0, cursorPos) + emoji.native + text.slice(cursorPos);
            messageInput.focus();
        },
        theme: 'light',
        set: 'facebook',
        showPreview: false,
        showSkinTones: false,
        style: {
            position: 'absolute',
            bottom: '60px',
            left: '0',
            display: 'none',
            zIndex: 999
        }
    });

    inputContainer.appendChild(emojiPicker.element);

    // Toggle emoji picker
    emojiButton.addEventListener('click', () => {
        emojiPicker.element.style.display = 
            emojiPicker.element.style.display === 'none' ? 'block' : 'none';
    });

    // Handle attachments
    attachButton.addEventListener('click', () => {
        attachMenu.classList.toggle('show');
    });

    // Setup attachment options
    document.querySelectorAll('.attach-option').forEach(option => {
        option.addEventListener('click', () => {
            switch(option.dataset.type) {
                case 'photo':
                    uploadFile('image/*');
                    break;
                case 'document':
                    uploadFile('*/*');
                    break;
                case 'camera':
                    openCamera();
                    break;
            }
            attachMenu.classList.remove('show');
        });
    });

    // Close menus when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.emoji-button')) {
            emojiPicker.element.style.display = 'none';
        }
        if (!e.target.closest('.attach-button') && !e.target.closest('.attach-menu')) {
            attachMenu.classList.remove('show');
        }
    });
}

// File upload handler
function uploadFile(accept) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
            uploadToStorage(file);
        }
    };
    input.click();
}

// Upload to Firebase Storage
async function uploadToStorage(file) {
    const storageRef = firebase.storage().ref();
    const fileRef = storageRef.child(`uploads/${Date.now()}_${file.name}`);
    
    try {
        const snapshot = await fileRef.put(file);
        const downloadURL = await snapshot.ref.getDownloadURL();
        sendFileMessage(downloadURL, file.type);
    } catch (error) {
        console.error('Upload failed:', error);
        alert('Upload failed. Please try again.');
    }
}

// Send file message
function sendFileMessage(url, type) {
    const messageData = {
        senderId: currentUser.id,
        timestamp: firebase.database.ServerValue.TIMESTAMP,
        fileURL: url,
        fileType: type,
        type: type.startsWith('image/') ? 'image' : 'document'
    };

    firebase.database().ref(`messages/${currentChat.id}`).push(messageData);
}

// Camera access
function openCamera() {
    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    
    navigator.mediaDevices.getUserMedia({ video: true })
        .then(stream => {
            video.srcObject = stream;
            video.play();
            
            // Add camera UI
            const cameraUI = createCameraUI(video, stream);
            document.body.appendChild(cameraUI);
        })
        .catch(err => {
            console.error('Camera access denied:', err);
            alert('Could not access camera');
        });
}

// Initialize the app
document.addEventListener('DOMContentLoaded', () => {
    const whatsApp = new WhatsAppChat();
});

class MessageHandler {
    constructor() {
        this.messageContainer = document.querySelector('.chat-messages');
        this.setupMessageHandling();
    }

    setupMessageHandling() {
        // Handle message sending
        document.querySelector('.message-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage(e.target.value);
                e.target.value = '';
            }
        });
    }

    sendMessage(text) {
        try {
            const messageElement = this.createMessageElement(text);
            this.messageContainer.appendChild(messageElement);
            this.scrollToBottom();
        } catch (error) {
            this.showError('Failed to send message. Please try again.');
        }
    }

    createMessageElement(text) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message sent';

        const content = document.createElement('div');
        content.className = 'message-content';
        
        // Check if it's a long message
        if (text.length > 100) {
            content.classList.add('long');
        }

        const textElement = document.createElement('div');
        textElement.className = 'message-text';
        
        // Format paragraphs
        const paragraphs = text.split('\n').filter(p => p.trim());
        if (paragraphs.length > 1) {
            textElement.classList.add('paragraph');
            paragraphs.forEach(p => {
                const para = document.createElement('p');
                para.textContent = p;
                textElement.appendChild(para);
            });
        } else {
            textElement.textContent = text;
        }

        const timeElement = document.createElement('div');
        timeElement.className = 'message-time';
        timeElement.textContent = this.formatTime(new Date());

        content.appendChild(textElement);
        content.appendChild(timeElement);
        messageDiv.appendChild(content);

        return messageDiv;
    }

    formatTime(date) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    showError(message) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'message-error';
        errorDiv.innerHTML = `
            <i class="fas fa-exclamation-circle"></i>
            <span>${message}</span>
        `;
        this.messageContainer.appendChild(errorDiv);
        setTimeout(() => errorDiv.remove(), 3000);
    }

    scrollToBottom() {
        this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const messageHandler = new MessageHandler();
});

class ChatSearch {
    constructor() {
        this.searchInput = document.querySelector('.search-input');
        this.chatList = document.querySelector('.chat-list');
        this.init();
    }

    init() {
        if (!this.searchInput || !this.chatList) {
            console.error('Required elements not found');
            return;
        }
        this.setupSearchListener();
    }

    setupSearchListener() {
        this.searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.trim().toLowerCase();
            this.filterChats(searchTerm);
        });
    }

    filterChats(searchTerm) {
        const chatItems = this.chatList.querySelectorAll('.chat-item');
        let hasResults = false;

        chatItems.forEach(chatItem => {
            // Get the name from the chat item (checking multiple possible elements)
            const nameElement = chatItem.querySelector('.chat-name, .user-name') || 
                              chatItem.querySelector('h2') || 
                              chatItem.querySelector('strong');
            
            if (!nameElement) return;

            const name = nameElement.textContent.toLowerCase();
            const matches = searchTerm === '' || name.includes(searchTerm);

            // Show/hide chat items based on match
            chatItem.style.display = matches ? 'flex' : 'none';

            if (matches) {
                this.highlightText(nameElement, searchTerm);
                hasResults = true;
            } else {
                this.removeHighlight(nameElement);
            }
        });

        this.toggleNoResults(!hasResults && searchTerm !== '');
    }

    highlightText(element, searchTerm) {
        if (!searchTerm) {
            element.textContent = element.textContent;
            return;
        }

        const text = element.textContent;
        const highlightedText = text.replace(
            new RegExp(searchTerm, 'gi'),
            match => `<span class="highlight">${match}</span>`
        );
        element.innerHTML = highlightedText;
    }

    removeHighlight(element) {
        if (element) {
            element.textContent = element.textContent;
        }
    }

    toggleNoResults(show) {
        let noResults = this.chatList.querySelector('.no-results');
        
        if (show) {
            if (!noResults) {
                noResults = document.createElement('div');
                noResults.className = 'no-results';
                noResults.innerHTML = `
                    <div class="no-results-content">
                        <i class="fas fa-search"></i>
                        <p>No matching users found</p>
                    </div>
                `;
                this.chatList.appendChild(noResults);
            }
        } else if (noResults) {
            noResults.remove();
        }
    }
}

// Initialize search functionality when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Make sure WhatsApp instance is initialized first
    if (typeof WhatsAppChat !== 'undefined') {
        const whatsApp = new WhatsAppChat();
    } else {
        console.error('WhatsAppChat class not found');
    }
});

class ChatManager {
    constructor() {
        this.db = firebase.firestore();
        this.chatList = document.querySelector('.chat-list');
        this.searchManager = new ChatSearch(this.chatList);
        this.setupRealtimeListeners();
        this.initializeLoading();
        this.setupMobileBackButton();
        this.mainChat = document.querySelector('.main-chat');
        this.defaultView = document.querySelector('.default-view');
        this.chatView = document.querySelector('.chat-view');
    }

    setupRealtimeListeners() {
        // Listen for messages collection changes
        this.db.collection('messages')
            .orderBy('timestamp', 'desc')
            .onSnapshot((snapshot) => {
                snapshot.docChanges().forEach((change) => {
                    if (change.type === 'added' || change.type === 'modified') {
                        this.updateLastMessage(change.doc.data());
                    }
                });
            });

        // Listen for user status changes
        this.db.collection('users')
            .onSnapshot((snapshot) => {
                snapshot.docChanges().forEach((change) => {
                    if (change.type === 'modified') {
                        this.updateUserStatus(change.doc.id, change.doc.data());
                    }
                });
            });
    }

    updateLastMessage(messageData) {
        const chatItem = document.querySelector(`[data-chat-id="${messageData.chatId}"]`);
        if (chatItem) {
            // Update last message
            const lastMessageElement = chatItem.querySelector('.chat-last-message');
            const timeElement = chatItem.querySelector('.chat-time');
            
            if (lastMessageElement) {
                lastMessageElement.textContent = messageData.text;
            }
            
            if (timeElement) {
                timeElement.textContent = this.formatTimestamp(messageData.timestamp);
            }

            // Move chat to top
            this.moveToTop(chatItem);
        }
    }

    moveToTop(chatItem) {
        const parent = chatItem.parentNode;
        parent.insertBefore(chatItem, parent.firstChild);
    }

    formatTimestamp(timestamp) {
        const date = timestamp.toDate();
        const now = new Date();
        
        if (date.toDateString() === now.toDateString()) {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else {
            return date.toLocaleDateString([], { weekday: 'short' });
        }
    }

    updateUserStatus(userId, status) {
        const userElement = document.querySelector(`[data-user-id="${userId}"]`);
        if (userElement) {
            const statusElement = userElement.querySelector('.user-status');
            const statusIndicator = userElement.querySelector('.status-indicator');

            if (status === 'online') {
                statusElement.textContent = 'online';
                statusElement.style.color = '#00a884';
                statusIndicator?.classList.add('online');
                statusIndicator?.classList.remove('offline');
            } else {
                statusElement.textContent = 'offline';
                statusElement.style.color = '#667781';
                statusIndicator?.classList.add('offline');
                statusIndicator?.classList.remove('online');
            }
        }
    }

    initializeLoading() {
        // Show loading screen when refreshing or navigating
        window.addEventListener('beforeunload', () => {
            document.body.classList.remove('loaded');
        });

        // Handle loading state for chat initialization
        firebase.auth().onAuthStateChanged((user) => {
            if (user) {
                this.loadInitialData().then(() => {
                    document.body.classList.add('loaded');
                });
            }
        });
    }

    async loadInitialData() {
        try {
            // Load your initial data here
            await Promise.all([
                this.loadChats(),
                this.loadUserProfile(),
                // Add other loading promises
            ]);
        } catch (error) {
            console.error('Error loading initial data:', error);
        }
    }

    setupMobileBackButton() {
        const backButton = document.querySelector('.back-button');
        if (backButton) {
            backButton.addEventListener('click', () => {
                if (window.innerWidth <= 768) {
                    document.body.classList.remove('chat-active');
                    if (this.defaultView) {
                        this.defaultView.style.display = 'flex';
                    }
                    if (this.chatView) {
                        this.chatView.style.display = 'none';
                    }
                }
            });
        }
    }

    selectChat(chatId, userName, userStatus, userAvatar) {
        // Update chat header with user info
        const chatHeader = document.querySelector('.chat-header');
        if (chatHeader) {
            chatHeader.querySelector('.chat-avatar').src = userAvatar;
            chatHeader.querySelector('.contact-name').textContent = userName;
            chatHeader.querySelector('.contact-status').textContent = userStatus;
        }

        // Show chat view and hide default view
        if (this.defaultView) {
            this.defaultView.style.display = 'none';
        }
        if (this.chatView) {
            this.chatView.style.display = 'flex';
        }
        if (this.mainChat) {
            this.mainChat.classList.add('chat-active');
        }

        // Handle mobile view
        if (window.innerWidth <= 768) {
            document.body.classList.add('chat-active');
        }

        // Load chat messages
        this.loadChatMessages(chatId);
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const chatManager = new ChatManager();
});

// Add this to handle profile page logout
class ProfileManager {
    constructor() {
        this.initializeLogout();
    }

    initializeLogout() {
        // Find the logout button in the profile modal
        const logoutBtn = document.querySelector('.logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.handleLogout();
            });
        }
    }

    async handleLogout() {
        try {
            const confirmed = await this.showLogoutConfirmation();
            
            if (confirmed) {
                // Show loading state
                document.body.classList.add('loading');
                
                // Sign out from Firebase
                await firebase.auth().signOut();
    
    // Clear any stored data
    localStorage.clear();
    sessionStorage.clear();
    
                // Hide app container and profile modal
                document.getElementById('app-container').style.display = 'none';
                document.getElementById('profile-modal').style.display = 'none';
                
                // Show login screen
                document.getElementById('login-screen').style.display = 'flex';
                
                // Reset form fields
                document.getElementById('login-email').value = '';
                document.getElementById('login-password').value = '';
            }
        } catch (error) {
            console.error('Logout error:', error);
            this.showError('Logout failed. Please try again.');
        } finally {
            document.body.classList.remove('loading');
        }
    }

    showLogoutConfirmation() {
        return new Promise((resolve) => {
            const dialogHtml = `
                <div class="logout-dialog">
                    <div class="logout-dialog-content">
                        <h3>Logout</h3>
                        <p>Are you sure you want to logout?</p>
                        <div class="logout-dialog-buttons">
                            <button class="cancel-button">Cancel</button>
                            <button class="confirm-button">Logout</button>
                        </div>
                    </div>
                </div>
            `;

            document.body.insertAdjacentHTML('beforeend', dialogHtml);
            const dialog = document.querySelector('.logout-dialog');

            // Add click handlers
            dialog.querySelector('.cancel-button').addEventListener('click', () => {
                dialog.remove();
                resolve(false);
            });

            dialog.querySelector('.confirm-button').addEventListener('click', () => {
                dialog.remove();
                resolve(true);
            });

            // Close on outside click
            dialog.addEventListener('click', (e) => {
                if (e.target === dialog) {
                    dialog.remove();
                    resolve(false);
                }
            });
        });
    }

    showError(message) {
        const errorToast = document.createElement('div');
        errorToast.className = 'error-toast';
        errorToast.textContent = message;
        
        document.body.appendChild(errorToast);
        
        setTimeout(() => {
            errorToast.remove();
        }, 3000);
    }
}

// Initialize the ProfileManager when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const profileManager = new ProfileManager();
});

class MobileResponsive {
    constructor() {
        this.sidebar = document.querySelector('.sidebar');
        this.mainChat = document.querySelector('.main-chat');
        this.backButton = document.querySelector('.back-button');
        this.init();
    }

    init() {
        // Initial setup
        this.setupBackButton();
        this.handleScreenSize();

        // Listen for screen size changes
        window.addEventListener('resize', () => this.handleScreenSize());
        
        // Setup chat item click listeners
        this.setupChatListeners();
    }

    setupBackButton() {
        if (this.backButton) {
            // Hide back button by default
            this.backButton.style.display = 'none';
            
            // Add click handler
            this.backButton.addEventListener('click', () => {
                this.showSidebar();
            });
        }
    }

    handleScreenSize() {
        const isMobile = window.innerWidth <= 768;
        
        if (this.backButton) {
            // Show/hide back button based on screen size
            this.backButton.style.display = isMobile ? 'flex' : 'none';
        }

        if (isMobile) {
            // Mobile view setup
            this.sidebar.style.display = 'flex';
            this.mainChat.style.display = 'flex';
        }
    }

    setupChatListeners() {
        const chatItems = document.querySelectorAll('.chat-item');
        chatItems.forEach(chat => {
            chat.addEventListener('click', () => {
                if (window.innerWidth <= 768) {
                    this.showMainChat();
                }
            });
        });
    }

    showSidebar() {
        if (window.innerWidth <= 768) {
            this.sidebar.style.display = 'flex';
            this.mainChat.style.display = 'none';
        }
    }

    showMainChat() {
        if (window.innerWidth <= 768) {
            this.sidebar.style.display = 'none';
            this.mainChat.style.display = 'flex';
        }
    }
}

// Add these styles
const styles = document.createElement('style');
styles.textContent = `
    .back-button {
        align-items: center;
        padding: 8px;
        cursor: pointer;
        color: #54656f;
        transition: all 0.2s ease;
    }

    .back-button i {
        font-size: 20px;
    }

    @media screen and (max-width: 768px) {
        .container {
            position: relative;
        }

        .sidebar, .main-chat {
            width: 100%;
            position: absolute;
            left: 0;
            top: 0;
            height: 100%;
            transition: all 0.3s ease;
        }

        .main-chat {
            z-index: 2;
        }

        .back-button {
            display: flex !important;
        }
    }

    @media screen and (min-width: 769px) {
        .back-button {
            display: none !important;
        }
    }
`;
document.head.appendChild(styles); 

// Add this to your existing script
document.addEventListener('DOMContentLoaded', () => {
    // Show loading screen
    const loadingScreen = document.querySelector('.loading-screen');
    const mainContent = document.querySelector('.container');
    
    // Simulate loading time (you can replace this with actual loading logic)
    setTimeout(() => {
        if (loadingScreen && mainContent) {
            // Hide loading screen
            loadingScreen.style.opacity = '0';
            loadingScreen.style.transition = 'opacity 0.5s ease';
            
            // Show main content
            mainContent.style.display = 'flex';
            document.body.classList.add('loaded');
            
            // Remove loading screen after fade out
            setTimeout(() => {
                loadingScreen.style.display = 'none';
            }, 500);
        }
    }, 2000); // Adjust time as needed
}); 

// Emoji functionality
const emojis = ["😀","😃","😄","😁","😆","😅","😂","🤣","😊","😇","🙂","🙃","😉","😌","😍","😘","😗","😙","😚","😋","😛","😝","😜","🤪","🤨","🧐","🤓","😎","🤩","😏","😒","😞","😔","😟","😕","🙁","😣","😖","😫","😩","🥺","😢","😭","😤","😠","😡","🤬","🤯","😳","🥵","🥶","😱","😨","😰","😥","😓","🤗","🤔","🤭","🤫","🤥","😶","😐","😑","😬","🙄","😯","😦","😧","😮","😲","🥱","😴","🤤","😪","😵","🤐","🥴","🤢","🤮","🤧","😷","🤒","🤕","🤑","🤠","😈","👿","👹","👺","🤡","💩","👻","💀"];

function initializeEmojiPicker() {
    const emojiButton = document.querySelector('.emoji-button');
    const messageInput = document.getElementById('message-input');
    const chatInput = document.querySelector('.chat-input');

    // Create emoji picker container
    const emojiPicker = document.createElement('div');
    emojiPicker.className = 'emoji-picker';
    emojiPicker.style.display = 'none';

    // Create emoji categories
    const categories = {
        'Smileys': ["😀","😃","😄","😁","😆","😅","😂","🤣","😊","😇","🙂","🙃","😉","😌","😍","😘","😗","😙","😚","😋","😛","😝","😜","🤪","🤨","🧐","🤓","😎","🤩","😏","😒","😞","😔","😟","😕","🙁","☹️","😣","😖","😫","😩","🥺","😢","😭","😤","😠","😡","🤬","🤯","😳","🥵","🥶","😱","😨","😰","😥","😓","🤗","🤔","🤭","🤫","🤥","😶","😐","😑","😬","🙄","😯","😦","😧","😮","😲","🥱","😴","🤤","😪","😵","🤐","🥴","🤢","🤮","🤧","😷","🤒","🤕","🤑","🤠"],
    
        'Animals': ["🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯","🦁","🐮","🐷","🐽","🐸","🐵","🙈","🙉","🙊","🐒","🐔","🐧","🐦","🐤","🐣","🐥","🦆","🦅","🦉","🦇","🐺","🐗","🐴","🦄","🐝","🐛","🦋","🐌","🐞","🐜","🦟","🦗","🕷","🕸","🦂","🐢","🐍","🦎","🦖","🦕","🐙","🦑","🦐","🦞","🦀","🐡","🐠","🐟","🐬","🐳","🐋","🦈","🐊","🐅","🐆","🦓","🦍","🦧","🐘","🦛","🦏","🐪","🐫","🦒","🦘","🐃","🐂","🐄","🐎","🐖","🐏","🐑","🦙","🐐","🦌","🐕","🐩","🦮","🐕‍🦺","🐈","🐓","🦃","🦚","🦜","🦢","🦩","🕊","🐇","🦝","🦨","🦡","🦦","🦥","🐁","🐀","🐿","🦔"],
    
        'Food': ["🍏","🍎","🍐","🍊","🍋","🍌","🍉","🍇","🍓","🍈","🍒","🍑","🥭","🍍","🥥","🥝","🍅","🍆","🥑","🥦","🥬","🥒","🌶","🌽","🥕","🧄","🧅","🥔","🍠","🥐","🥯","🍞","🥖","🥨","🧀","🥚","🍳","🧈","🥞","🧇","🥓","🥩","🍗","🍖","🦴","🌭","🍔","🍟","🍕","🥪","🥙","🧆","🌮","🌯","🥗","🥘","🥫","🍝","🍜","🍲","🍛","🍣","🍱","🥟","🦪","🍤","🍙","🍚","🍘","🍥","🥠","🥮","🍢","🍡","🍧","🍨","🍦","🥧","🧁","🍰","🎂","🍮","🍭","🍬","🍫","🍿","🍩","🍪","🌰","🥜","🍯","🥛","🍼","☕️","🍵","🧃","🥤","🍶","🍺","🍻","🥂","🍷","🥃","🍸","🍹","🧉","🍾","🧊"],
    
        'Travel': ["🚗","🚕","🚙","🚌","🚎","🏎","🚓","🚑","🚒","🚐","🚚","🚛","🚜","🦯","🦽","🦼","🛴","🚲","🛵","🏍","🛺","🚨","🚔","🚍","🚘","🚖","🚡","🚠","🚟","🚃","🚋","🚞","🚝","🚄","🚅","🚈","🚂","🚆","🚇","🚊","🚉","✈️","🛫","🛬","🛩","💺","🛰","🚀","🛸","🚁","🛶","⛵️","🚤","🛥","🛳","⛴","🚢","⚓️","⛽️","🚧","🚦","🚥","🚏","🗺","🗿","🗽","🗼","🏰","🏯","🏟","🎡","🎢","🎠","⛲️","⛱","🏖","🏝","🏜","🌋","⛰","🏔","🗻","🏕","⛺️","🏠","🏡","🏘","🏚","🏗","🏭","🏢","🏬","🏣","🏤","🏥","🏦","🏨","🏪","🏫","🏩","💒","🏛","⛪️","🕌","🕍","🛕","🕋","⛩","🛤","🛣","🗾","🎑","🏞","🌅","🌄","🌠","🎇","🎆","🌇","🌆","🏙","🌃","🌌","🌉","🌁"],
    
        'Objects': ["⌚️","📱","📲","💻","⌨️","🖥","🖨","🖱","🖲","🕹","🗜","💽","💾","💿","📀","📼","📷","📸","📹","🎥","📽","🎞","📞","☎️","📟","📠","📺","📻","🎙","🎚","🎛","🧭","⏱","⏲","⏰","🕰","⌛️","⏳","📡","🔋","🔌","💡","🔦","🕯","🪔","🧯","🛢","💸","💵","💴","💶","💷","💰","💳","💎","⚖️","🧰","🔧","🔨","⚒","🛠","⛏","🔩","⚙️","🧱","⛓","🧲","🔫","💣","🧨","🪓","🔪","🗡","⚔️","🛡","🚬","⚰️","⚱️","🏺","🔮","📿","🧿","💈","⚗️","🔭","🔬","🕳","🩹","🩺","💊","💉","🧬","🦠","🧫","🧪","🌡","🧹","🧺","🧻","🚽","🚰","🚿","🛁","🛀","🧼","🪒","🧽","🧴","🛎","🔑","🗝","🚪","🪑","🛋","🛏","🛌","🧸","🖼","🛍","🛒","🎁","🎈","🎏","🎀","🎊","🎉","🎎","🏮","🎐","🧧","✉️","📩","📨","📧","💌","📥","📤","📦","🏷","📪","📫","📬","📭","📮","📯","📜","📃","📄","📑","🧾","📊","📈","📉","🗒","🗓","📆","📅","🗑","📇","🗃","🗳","🗄","📋","📁","📂","🗂","🗞","📰","📓","📔","📒","📕","📗","📘","📙","📚","📖","🔖","🧷","🔗","📎","🖇","📐","📏","🧮","📌","📍","✂️","🖊","🖋","✒️","🖌","🖍","📝","✏️","🔍","🔎","🔏","🔐","🔒","🔓"],
    
        'Symbols': ["❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❣️","💕","💞","💓","💗","💖","💘","💝","💟","☮️","✝️","☪️","🕉","☸️","✡️","🔯","🕎","☯️","☦️","🛐","⛎","♈️","♉️","♊️","♋️","♌️","♍️","♎️","♏️","♐️","♑️","♒️","♓️","🆔","⚛️","🉑","☢️","☣️","📴","📳","🈶","🈚️","🈸","🈺","🈷️","✴️","🆚","💮","🉐","㊙️","㊗️","🈴","🈵","🈹","🈲","🅰️","🅱️","🆎","🆑","🅾️","🆘","❌","⭕️","🛑","⛔️","📛","🚫","💯","💢","♨️","🚷","🚯","🚳","🚱","🔞","📵","🚭","❗️","❕","❓","❔","‼️","⁉️","🔅","🔆","〽️","⚠️","🚸","🔱","⚜️","🔰","♻️","✅","🈯️","💹","❇️","✳️","❎","🌐","💠","Ⓜ️","🌀","💤","🏧","🚾","♿️","🅿️","🈳","🈂️","🛂","🛃","🛄","🛅","🚹","🚺","🚼","🚻","🚮","🎦","📶","🈁","🔣","ℹ️","🔤","🔡","🔠","🆖","🆗","🆙","🆒","🆕","🆓","0️⃣","1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟","🔢","#️⃣","*️⃣","⏏️","▶️","⏸","⏯","⏹","⏺","⏭","⏮","⏩","⏪","⏫","⏬","◀️","🔼","🔽","➡️","⬅️","⬆️","⬇️","↗️","↘️","↙️","↖️","↕️","↔️","↪️","↩️","⤴️","⤵️","🔀","🔁","🔂","🔄","🔃","🎵","🎶","➕","➖","➗","✖️","♾","💲","💱","™️","©️","®️","〰️","➰","➿","🔚","🔙","🔛","🔝","🔜","✔️","☑️","🔘","🔴","🟠","🟡","🟢","🔵","🟣","⚫️","⚪️","🟤","🔺","🔻","🔸","🔹","🔶","🔷","🔳","🔲","▪️","▫️","◾️","◽️","◼️","◻️","🟥","🟧","🟨","🟩","🟦","🟪","⬛️","⬜️","🟫","🔈","🔇","🔉","🔊","🔔","🔕","📣","📢","👁‍🗨","💬","💭","🗯","♠️","♣️","♥️","♦️","🃏","🎴","🀄️","🕐","🕑","🕒","🕓","🕔","🕕","🕖","🕗","🕘","🕙","🕚","🕛","🕜","🕝","🕞","🕟","🕠","🕡","🕢","🕣","🕤","🕥","🕦","🕧"]
    };

    // Create category tabs
    const categoryTabs = document.createElement('div');
    categoryTabs.className = 'emoji-categories';
    
    Object.keys(categories).forEach((category, index) => {
        const tab = document.createElement('button');
        tab.className = 'emoji-category-tab';
        tab.textContent = category;
        tab.onclick = () => showCategory(category);
        if (index === 0) tab.classList.add('active');
        categoryTabs.appendChild(tab);
    });

    emojiPicker.appendChild(categoryTabs);

    // Create emoji container
    const emojiContainer = document.createElement('div');
    emojiContainer.className = 'emoji-container';
    emojiPicker.appendChild(emojiContainer);

    function showCategory(category) {
        // Update active tab
        document.querySelectorAll('.emoji-category-tab').forEach(tab => {
            tab.classList.remove('active');
            if (tab.textContent === category) tab.classList.add('active');
        });

        // Show emojis
        emojiContainer.innerHTML = '';
        categories[category].forEach(emoji => {
            const emojiSpan = document.createElement('span');
            emojiSpan.className = 'emoji';
            emojiSpan.textContent = emoji;
            emojiSpan.onclick = () => {
                insertEmoji(emoji);
                toggleEmojiPicker();
            };
            emojiContainer.appendChild(emojiSpan);
        });
    }

    // Toggle emoji picker
    function toggleEmojiPicker() {
        const isVisible = emojiPicker.style.display === 'block';
        emojiPicker.style.display = isVisible ? 'none' : 'block';
        if (!isVisible) showCategory('Smileys'); // Show first category by default
    }

    // Insert emoji at cursor position
    function insertEmoji(emoji) {
        const start = messageInput.selectionStart;
        const end = messageInput.selectionEnd;
        const text = messageInput.value;
        const before = text.substring(0, start);
        const after = text.substring(end);
        messageInput.value = before + emoji + after;
        messageInput.selectionStart = messageInput.selectionEnd = start + emoji.length;
        messageInput.focus();
    }

    // Add click handlers
    emojiButton.onclick = toggleEmojiPicker;
    
    // Close emoji picker when clicking outside
    document.addEventListener('click', (e) => {
        if (!emojiPicker.contains(e.target) && !emojiButton.contains(e.target)) {
            emojiPicker.style.display = 'none';
        }
    });

    // Add emoji picker to chat input
    chatInput.appendChild(emojiPicker);

    // Show first category
    showCategory('Smileys');
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    initializeEmojiPicker();
});

function toggleOptionsMenu() {
    const menu = document.getElementById('options-menu');
    menu.classList.toggle('show');
    
    // Close menu when clicking outside
    document.addEventListener('click', function closeMenu(e) {
        if (!menu.contains(e.target) && !e.target.matches('.fa-ellipsis-vertical')) {
            menu.classList.remove('show');
            document.removeEventListener('click', closeMenu);
        }
    });
} 

// Add this new function
function toggleChatOptionsMenu() {
    const menu = document.getElementById('chat-options-menu');
    menu.classList.toggle('show');
    
    // Close menu when clicking outside
    document.addEventListener('click', function closeMenu(e) {
        if (!menu.contains(e.target) && !e.target.matches('.fa-ellipsis-vertical')) {
            menu.classList.remove('show');
            document.removeEventListener('click', closeMenu);
        }
    });
}

// Add this to close both menus when clicking outside
document.addEventListener('click', (e) => {
    const sidebarMenu = document.getElementById('options-menu');
    const chatMenu = document.getElementById('chat-options-menu');
    const sidebarButton = e.target.matches('.sidebar .fa-ellipsis-vertical');
    const chatButton = e.target.matches('.chat-actions .fa-ellipsis-vertical');

    if (!sidebarButton && !chatButton) {
        if (!sidebarMenu.contains(e.target)) {
            sidebarMenu.classList.remove('show');
        }
        if (!chatMenu.contains(e.target)) {
            chatMenu.classList.remove('show');
        }
    }
}); 

// Add this to your existing script
let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];
let recordingTimer = null;
let recordingStartTime = null;

function initializeVoiceRecording() {
    const voiceButton = document.getElementById('voice-record-btn');
    const sendButton = document.getElementById('send-button');
    const messageInput = document.getElementById('message-input');
    
    let mediaRecorder = null;
    let audioChunks = [];
    let isRecording = false;
    let recordingStartTime = null;
    let recordingTimer = null;

    // Create voice recording UI
    const recordingUI = document.createElement('div');
    recordingUI.className = 'voice-recording-ui';
    recordingUI.innerHTML = `
        <div class="recording-indicator">
            <i class="fas fa-microphone recording-icon"></i>
            <span class="recording-time">0:00</span>
        </div>
        <div class="recording-controls">
            <button class="cancel-recording" onclick="cancelRecording()">
                <i class="fas fa-times"></i>
            </button>
            <button class="send-recording" onclick="sendRecording()">
                <i class="fas fa-paper-plane"></i>
            </button>
        </div>
    `;
    document.querySelector('.chat-input').appendChild(recordingUI);

    voiceButton.addEventListener('click', async () => {
        if (!isRecording) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                startRecording(stream);
            } catch (error) {
                console.error('Error accessing microphone:', error);
                alert('Could not access microphone');
            }
        } else {
            stopRecording();
        }
    });

    function startRecording(stream) {
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        isRecording = true;

        mediaRecorder.ondataavailable = (event) => {
            audioChunks.push(event.data);
        };

        mediaRecorder.start();
        recordingStartTime = Date.now();
        updateRecordingUI(true);
        startRecordingTimer();
    }

    function stopRecording() {
        if (!mediaRecorder) return;

        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
        isRecording = false;
        stopRecordingTimer();
        updateRecordingUI(false);

        // Create audio blob and send
        const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
        uploadAndSendVoiceMessage(audioBlob);
    }

    function updateRecordingUI(isRecording) {
        recordingUI.style.display = isRecording ? 'flex' : 'none';
        voiceButton.classList.toggle('recording', isRecording);
        voiceButton.querySelector('i').className = isRecording ? 'fas fa-stop' : 'fas fa-microphone';
    }

    function startRecordingTimer() {
        const timerDisplay = recordingUI.querySelector('.recording-time');
        recordingTimer = setInterval(() => {
            const duration = Math.floor((Date.now() - recordingStartTime) / 1000);
            const minutes = Math.floor(duration / 60);
            const seconds = duration % 60;
            timerDisplay.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }, 1000);
    }

    function stopRecordingTimer() {
        clearInterval(recordingTimer);
    }

    async function uploadAndSendVoiceMessage(audioBlob) {
        try {
            const storage = firebase.storage();
            const storageRef = storage.ref();
            const audioRef = storageRef.child(`voice_messages/${Date.now()}.wav`);

            // Upload audio file
            const uploadTask = audioRef.put(audioBlob);
            
            uploadTask.on('state_changed',
                (snapshot) => {
                    const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                    console.log('Upload progress:', progress);
                },
                (error) => {
                    console.error('Upload error:', error);
                    alert('Failed to send voice message');
                },
                async () => {
                    const downloadURL = await uploadTask.snapshot.ref.getDownloadURL();
                    
                    // Save message to database
                    const message = {
                        type: 'voice',
                        url: downloadURL,
                        sender: firebase.auth().currentUser.uid,
                        timestamp: firebase.database.ServerValue.TIMESTAMP,
                        duration: Math.floor((Date.now() - recordingStartTime) / 1000)
                    };

                    await firebase.database().ref('messages').push(message);
                }
            );
        } catch (error) {
            console.error('Error sending voice message:', error);
            alert('Failed to send voice message');
        }
    }
}

function sendVoiceMessage(audioBlob) {
    // Here you would typically:
    // 1. Upload the audio blob to your server or storage
    // 2. Get the URL of the uploaded audio
    // 3. Send the message with the audio URL
    console.log('Sending voice message:', audioBlob);
}

// Initialize voice recording when the chat is ready
document.addEventListener('DOMContentLoaded', () => {
    initializeVoiceRecording();
});

// Add this function to update user count
function updateUserCount() {
    const usersRef = firebase.database().ref('users');
    
    usersRef.on('value', (snapshot) => {
        let count = 0;
        snapshot.forEach((childSnapshot) => {
            const user = childSnapshot.val();
            // Don't count the current user
            if (user.id !== firebase.auth().currentUser.uid) {
                count++;
            }
        });
        
        // Update the badge
        const badge = document.querySelector('.user-count-badge');
        if (badge) {
            badge.textContent = count;
            // Hide badge if count is 0
            badge.style.display = count > 0 ? 'flex' : 'none';
        }
    });
}

// Call this when the app initializes
document.addEventListener('DOMContentLoaded', () => {
    // ... existing initialization code ...
    updateUserCount();
});

// Add this to your existing script
function initializeImageUpload() {
    const photoUpload = document.getElementById('photo-upload');
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-button');
    const voiceButton = document.getElementById('voice-record-btn');
    
    let selectedImage = null;

    // Create image preview container
    let previewContainer = document.querySelector('.image-preview-container');
    if (!previewContainer) {
        previewContainer = document.createElement('div');
        previewContainer.className = 'image-preview-container';
        document.querySelector('.chat-input').insertBefore(previewContainer, null);
    }

    photoUpload.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (file && file.type.startsWith('image/')) {
            selectedImage = file;
            showImagePreview(file);
            toggleSendButton(true);
        }
    });

    function showImagePreview(file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            previewContainer.innerHTML = `
                <img src="${e.target.result}" class="message-image-preview" alt="Selected image">
                <div class="image-preview-content">
                    <input type="text" class="image-caption" placeholder="Add a caption...">
                    <div class="image-preview-actions">
                        <button class="cancel-upload" onclick="cancelImageUpload()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>
            `;
            previewContainer.style.display = 'flex';
            previewContainer.querySelector('.image-caption').focus();
        };
        reader.readAsDataURL(file);
    }

    window.cancelImageUpload = function() {
        selectedImage = null;
        previewContainer.style.display = 'none';
        photoUpload.value = '';
        if (!messageInput.value.trim()) {
            toggleSendButton(false);
        }
    };

    sendButton.addEventListener('click', function() {
        if (selectedImage) {
            const caption = previewContainer.querySelector('.image-caption')?.value.trim() || '';
            sendImageMessage(selectedImage, caption);
        } else if (messageInput.value.trim()) {
            sendMessage();
        }
    });

    function sendImageMessage(imageFile, caption) {
        const storage = firebase.storage();
        const storageRef = storage.ref();
        const imageRef = storageRef.child(`chat_images/${Date.now()}_${imageFile.name}`);

        sendButton.disabled = true;

        const uploadTask = imageRef.put(imageFile);

        uploadTask.on('state_changed', 
            (snapshot) => {
                const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                console.log('Upload progress:', progress);
            },
            (error) => {
                console.error('Upload error:', error);
                alert('Failed to upload image. Please try again.');
                sendButton.disabled = false;
            },
            () => {
                uploadTask.snapshot.ref.getDownloadURL()
                    .then((downloadURL) => {
                        const messageData = {
                            imageUrl: downloadURL,
                            caption: caption,
                            senderId: currentUser.id,
                            timestamp: firebase.database.ServerValue.TIMESTAMP,
                            type: 'image'
                        };
                        return firebase.database().ref(`messages/${currentChat.id}`).push(messageData);
                    })
                    .then(() => {
                        selectedImage = null;
                        previewContainer.style.display = 'none';
                        photoUpload.value = '';
                        sendButton.disabled = false;
                        toggleSendButton(false);
                    })
                    .catch((error) => {
                        console.error('Error sending image message:', error);
                        alert('Failed to send image message. Please try again.');
                        sendButton.disabled = false;
                    });
            }
        );
    }

    function toggleSendButton(show) {
        if (show) {
            voiceButton.style.display = 'none';
            sendButton.style.display = 'block';
            sendButton.classList.add('show');
        } else {
            sendButton.classList.remove('show');
            setTimeout(() => {
                sendButton.style.display = 'none';
                voiceButton.style.display = 'block';
            }, 200);
        }
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    setupMessageInput();
    initializeImageUpload();
    initializeMessageDelete();
});

// Initialize Firebase Storage
function initializeFirebaseStorage() {
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }
    return firebase.storage();
}

// Add message delete functionality
function initializeMessageDelete() {
    const chatMessages = document.querySelector('.chat-messages');

    // Add long press and right-click handlers for messages
    chatMessages.addEventListener('contextmenu', handleMessageRightClick);
    chatMessages.addEventListener('mousedown', handleMessageLongPress);
    chatMessages.addEventListener('mouseup', () => clearTimeout(pressTimer));
    chatMessages.addEventListener('mouseleave', () => clearTimeout(pressTimer));

    let pressTimer;

    function handleMessageLongPress(e) {
        const messageElement = e.target.closest('.message');
        if (!messageElement) return;

        pressTimer = setTimeout(() => {
            showDeleteOptions(messageElement);
        }, 500);
    }

    function handleMessageRightClick(e) {
        e.preventDefault();
        const messageElement = e.target.closest('.message');
        if (!messageElement) return;
        showDeleteOptions(messageElement);
    }

    function showDeleteOptions(messageElement) {
        const existingDialog = document.querySelector('.delete-dialog');
        if (existingDialog) existingDialog.remove();

        const isSentByMe = messageElement.classList.contains('sent');
        const messageId = messageElement.getAttribute('data-message-id');

        const deleteDialog = document.createElement('div');
        deleteDialog.className = 'delete-dialog';
        deleteDialog.innerHTML = `
            <div class="delete-dialog-content">
                <div class="delete-dialog-header">
                    <h3>Delete Message?</h3>
                </div>
                <div class="delete-options">
                    <button class="delete-option delete-for-me">
                        <i class="fas fa-trash"></i>
                        Delete for me
                    </button>
                    ${isSentByMe ? `
                        <button class="delete-option delete-for-everyone">
                            <i class="fas fa-trash-alt"></i>
                            Delete for everyone
                        </button>
                    ` : ''}
                </div>
                <button class="cancel-delete">CANCEL</button>
            </div>
        `;

        deleteDialog.querySelector('.delete-for-me').onclick = () => {
            deleteMessageForMe(messageId);
            deleteDialog.remove();
        };

        if (isSentByMe) {
            deleteDialog.querySelector('.delete-for-everyone').onclick = () => {
                deleteMessageForEveryone(messageId);
                deleteDialog.remove();
            };
        }

        deleteDialog.querySelector('.cancel-delete').onclick = () => {
            deleteDialog.remove();
        };

        deleteDialog.onclick = (e) => {
            if (e.target === deleteDialog) {
                deleteDialog.remove();
            }
        };

        document.body.appendChild(deleteDialog);
    }

    function deleteMessageForMe(messageId) {
        if (!messageId) return;

        const messagesRef = firebase.database().ref('messages');
        const currentUser = firebase.auth().currentUser.uid;

        messagesRef.child(messageId).update({
            [`deletedFor/${currentUser}`]: true,
            deletedAt: firebase.database.ServerValue.TIMESTAMP
        }).then(() => {
            const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
            if (messageElement) {
                messageElement.remove();
            }
        }).catch(error => {
            console.error('Error deleting message:', error);
            alert('Failed to delete message');
        });
    }

    function deleteMessageForEveryone(messageId) {
        if (!messageId) return;

        const messagesRef = firebase.database().ref('messages');
        const currentUser = firebase.auth().currentUser.uid;

        messagesRef.child(messageId).update({
            deleted: true,
            deletedBy: currentUser,
            deletedAt: firebase.database.ServerValue.TIMESTAMP,
            content: null,
            text: null,
            imageUrl: null
        }).then(() => {
            const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
            if (messageElement) {
                messageElement.innerHTML = `
                    <div class="message-content deleted">
                        <span class="deleted-text">This message was deleted</span>
                        <div class="message-time">${formatTime(Date.now())}</div>
                    </div>
                `;
                messageElement.classList.add('deleted');
            }
        }).catch(error => {
            console.error('Error deleting message:', error);
            alert('Failed to delete message');
        });
    }

    // Listen for message deletions in real-time
    const messagesRef = firebase.database().ref('messages');
    messagesRef.on('child_changed', (snapshot) => {
        const message = snapshot.val();
        const messageId = snapshot.key;
        const currentUser = firebase.auth().currentUser.uid;

        // Handle message deleted for everyone
        if (message.deleted) {
            const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
            if (messageElement) {
                messageElement.innerHTML = `
                    <div class="message-content deleted">
                        <span class="deleted-text">This message was deleted</span>
                        <div class="message-time">${formatTime(message.deletedAt)}</div>
                    </div>
                `;
                messageElement.classList.add('deleted');
            }
        }
        // Handle message deleted for current user
        else if (message.deletedFor && message.deletedFor[currentUser]) {
            const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
            if (messageElement) {
                messageElement.remove();
            }
        }
    });
}

// Update the message display function
function displayMessage(message, messageId) {
    if (!message || !messageId) return null;

    const currentUser = firebase.auth().currentUser.uid;
    
    // Don't display if deleted for current user
    if (message.deletedFor && message.deletedFor[currentUser]) {
        return null;
    }

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${message.sender === currentUser ? 'sent' : 'received'}`;
    messageDiv.setAttribute('data-message-id', messageId);

    if (message.deleted) {
        messageDiv.classList.add('deleted');
        messageDiv.innerHTML = `
            <div class="message-content deleted">
                <span class="deleted-text">This message was deleted</span>
                <div class="message-time">${formatTime(message.deletedAt)}</div>
            </div>
        `;
    } else {
        messageDiv.innerHTML = `
            <div class="message-content">
                ${message.imageUrl ? 
                    `<img src="${message.imageUrl}" alt="Sent image" class="message-image">` : 
                    `<div class="message-text">${message.text}</div>`
                }
                ${message.caption ? `<div class="message-caption">${message.caption}</div>` : ''}
                <div class="message-time">${formatTime(message.timestamp)}</div>
            </div>
        `;
    }

    return messageDiv;
}

document.addEventListener('DOMContentLoaded', () => {
    initializeVoiceRecording();
    initializeImageUpload();
});

function initializeChatSelection() {
    const mainChat = document.querySelector('.main-chat');
    const chatList = document.querySelector('.chat-list');
    
    // Add click handler for chat list items
    chatList.addEventListener('click', (e) => {
        const chatItem = e.target.closest('.chat-item');
        if (!chatItem) return;

        // Show chat interface
        mainChat.classList.add('chat-active');

        // Update chat header with user info
        const userId = chatItem.getAttribute('data-user-id');
        const userRef = firebase.database().ref(`users/${userId}`);
        userRef.once('value').then((snapshot) => {
            const user = snapshot.val();
            if (user) {
                updateChatHeader(user);
            }
        });

        // Handle mobile view
        if (window.innerWidth <= 768) {
            document.querySelector('.sidebar').style.display = 'none';
            document.querySelector('.main-chat').style.display = 'flex';
        }
    });

    // Back button handler
    const backButton = document.querySelector('.back-button');
    if (backButton) {
        backButton.addEventListener('click', () => {
            // Hide chat interface
            mainChat.classList.remove('chat-active');

            // Handle mobile view
            if (window.innerWidth <= 768) {
                document.querySelector('.sidebar').style.display = 'flex';
                document.querySelector('.main-chat').style.display = 'none';
            }
        });
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    initializeChatSelection();
    initializeVoiceRecording();
    initializeImageUpload();
    initializeMessageDelete();
});

// ...existing code...

function setupMessageInput() {
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-button');
    const voiceButton = document.getElementById('voice-record-btn');

    // Initially show the microphone button
    sendButton.style.display = 'none';
    voiceButton.style.display = 'block';

    // Toggle send button based on input
    messageInput.addEventListener('input', () => {
        if (messageInput.value.trim()) {
            sendButton.style.display = 'block';
            voiceButton.style.display = 'none';
        } else {
            sendButton.style.display = 'none';
            voiceButton.style.display = 'block';
        }
    });

    // Enter key handler
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Click handler
    sendButton.addEventListener('click', (e) => {
        e.preventDefault();
        sendMessage();
    });
}

// ...existing code...

function initializeImageUpload() {
    const photoUpload = document.getElementById('photo-upload');
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-button');
    const voiceButton = document.getElementById('voice-record-btn');
    
    let selectedImage = null;

    // Create image preview container
    let previewContainer = document.querySelector('.image-preview-container');
    if (!previewContainer) {
        previewContainer = document.createElement('div');
        previewContainer.className = 'image-preview-container';
        document.querySelector('.chat-input').insertBefore(previewContainer, null);
    }

    photoUpload.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (file && file.type.startsWith('image/')) {
            selectedImage = file;
            showImagePreview(file);
            toggleSendButton(true);
        }
    });

    function showImagePreview(file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            previewContainer.innerHTML = `
                <img src="${e.target.result}" class="message-image-preview" alt="Selected image">
                <div class="image-preview-content">
                    <input type="text" class="image-caption" placeholder="Add a caption...">
                    <div class="image-preview-actions">
                        <button class="cancel-upload" onclick="cancelImageUpload()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>
            `;
            previewContainer.style.display = 'flex';
            previewContainer.querySelector('.image-caption').focus();
        };
        reader.readAsDataURL(file);
    }

    window.cancelImageUpload = function() {
        selectedImage = null;
        previewContainer.style.display = 'none';
        photoUpload.value = '';
        if (!messageInput.value.trim()) {
            toggleSendButton(false);
        }
    };

    sendButton.addEventListener('click', function() {
        if (selectedImage) {
            const caption = previewContainer.querySelector('.image-caption')?.value.trim() || '';
            sendImageMessage(selectedImage, caption);
        } else if (messageInput.value.trim()) {
            sendMessage();
        }
    });

    function sendImageMessage(imageFile, caption) {
        const storage = firebase.storage();
        const storageRef = storage.ref();
        const imageRef = storageRef.child(`chat_images/${Date.now()}_${imageFile.name}`);

        sendButton.disabled = true;

        const uploadTask = imageRef.put(imageFile);

        uploadTask.on('state_changed', 
            (snapshot) => {
                const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                console.log('Upload progress:', progress);
            },
            (error) => {
                console.error('Upload error:', error);
                alert('Failed to upload image. Please try again.');
                sendButton.disabled = false;
            },
            () => {
                uploadTask.snapshot.ref.getDownloadURL()
                    .then((downloadURL) => {
                        const messageData = {
                            imageUrl: downloadURL,
                            caption: caption,
                            senderId: currentUser.id,
                            timestamp: firebase.database.ServerValue.TIMESTAMP,
                            type: 'image'
                        };
                        return firebase.database().ref(`messages/${currentChat.id}`).push(messageData);
                    })
                    .then(() => {
                        selectedImage = null;
                        previewContainer.style.display = 'none';
                        photoUpload.value = '';
                        sendButton.disabled = false;
                        toggleSendButton(false);
                    })
                    .catch((error) => {
                        console.error('Error sending image message:', error);
                        alert('Failed to send image message. Please try again.');
                        sendButton.disabled = false;
                    });
            }
        );
    }

    function toggleSendButton(show) {
        if (show) {
            voiceButton.style.display = 'none';
            sendButton.style.display = 'block';
            sendButton.classList.add('show');
        } else {
            sendButton.classList.remove('show');
            setTimeout(() => {
                sendButton.style.display = 'none';
                voiceButton.style.display = 'block';
            }, 200);
        }
    }
}
// Find your message handling code (where you receive new messages) and add the sound
function handleNewMessage(message) {
    // Your existing message handling code...
    
    // Play notification sound if the message is not from the current user
    if (message.senderId !== currentUserId && !document.hasFocus()) {
        playNotificationSound();
    }
}

function setupGlobalMessageListener() {
    firebase.database().ref('messages').on('child_added', (chatSnapshot) => {
        chatSnapshot.ref.limitToLast(1).on('child_added', (messageSnapshot) => {
            const message = messageSnapshot.val();
            if (shouldPlayNotification(message)) {
                playNotificationSound();
            }
        });
    });
}
// Update your initialization code
document.addEventListener('DOMContentLoaded', () => {
    // ...existing initialization code...
    setupGlobalMessageListener();
});


// ...existing code...

document.addEventListener('DOMContentLoaded', () => {
    setupMessageInput();
    initializeImageUpload();
    // ...existing code...
});
