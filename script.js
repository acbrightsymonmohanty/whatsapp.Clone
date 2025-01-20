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

class WhatsAppChat {
    constructor() {
        this.db = firebase.firestore();
        this.auth = firebase.auth();
        this.chatList = document.querySelector('.chat-list');
        this.searchInput = document.querySelector('.search-input');
        this.unsubscribeListeners = [];
        this.addHeaderWithLogout();
        this.init();
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
        // Assuming Firebase auth is available globally or passed from elsewhere
        const auth = firebase.auth(); // Replace with your auth service if not using Firebase
        const logoutHandler = new LogoutHandler(auth);
        
        // Call the handleLogout method
        logoutHandler.handleLogout();
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
        this.setupSearchListener();
        this.setupRealtimeListeners();
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
        this.searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase().trim();
            this.filterChats(searchTerm);
        });
    }

    filterChats(searchTerm) {
        const chats = this.chatList.querySelectorAll('.chat-item');
        let hasResults = false;

        chats.forEach(chat => {
            const name = chat.querySelector('.chat-name').textContent.toLowerCase();
            const message = chat.querySelector('.chat-last-message').textContent.toLowerCase();
            const matches = name.includes(searchTerm) || message.includes(searchTerm);

            chat.style.display = matches || !searchTerm ? 'flex' : 'none';
            
            if (matches && searchTerm) {
                this.highlightText(chat, searchTerm);
                hasResults = true;
            } else {
                this.removeHighlight(chat);
            }
        });

        this.toggleNoResults(!hasResults && searchTerm);
    }

    createChatElement(chatData, chatId) {
        const div = document.createElement('div');
        div.className = 'chat-item';
        div.dataset.chatId = chatId;
        div.dataset.timestamp = chatData.lastMessageTime?.toMillis() || 0;

        div.innerHTML = `
            <div class="chat-avatar">
                ${chatData.name ? chatData.name.charAt(0).toUpperCase() : 'U'}
            </div>
            <div class="chat-details">
                <div class="chat-header">
                    <span class="chat-name">${chatData.name || 'Unnamed'}</span>
                    <span class="chat-time">${this.formatTime(chatData.lastMessageTime)}</span>
                </div>
                <div class="chat-info">
                    <span class="chat-last-message">${chatData.lastMessage || ''}</span>
                </div>
            </div>
        `;

        return div;
    }

    highlightText(chatElement, searchTerm) {
        const elements = [
            chatElement.querySelector('.chat-name'),
            chatElement.querySelector('.chat-last-message')
        ];

        elements.forEach(element => {
            if (element) {
                const text = element.textContent;
                const highlightedText = text.replace(
                    new RegExp(searchTerm, 'gi'),
                    match => `<span class="highlight">${match}</span>`
                );
                element.innerHTML = highlightedText;
            }
        });
    }

    removeHighlight(chatElement) {
        const highlights = chatElement.querySelectorAll('.highlight');
        highlights.forEach(highlight => {
            const parent = highlight.parentNode;
            parent.textContent = parent.textContent;
        });
    }

    toggleNoResults(show) {
        let noResults = document.querySelector('.no-results');
        if (show) {
            if (!noResults) {
                noResults = document.createElement('div');
                noResults.className = 'no-results';
                noResults.innerHTML = `
                    <div class="no-results-content">
                        <i class="fas fa-search"></i>
                        <p>No chats found</p>
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

// Login existing user with email
function loginUser(event) {
    event.preventDefault();
    
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    auth.signInWithEmailAndPassword(email, password)
        .then((userCredential) => {
            // Login successful, auth state listener will handle the redirect
            console.log('Login successful');
        })
        .catch((error) => {
            console.error('Login error:', error);
            alert('Login failed: ' + error.message);
        });
}

// Auth state change listener
auth.onAuthStateChanged((user) => {
    if (user) {
        // User is signed in
        console.log('User is signed in:', user);
        
        // Get additional user data from database
        database.ref('users/' + user.uid).once('value')
            .then((snapshot) => {
                currentUser = snapshot.val();
                showApp();
                
                // Update user status
                database.ref('users/' + user.uid).update({
                    status: 'online',
                    lastSeen: firebase.database.ServerValue.TIMESTAMP
                });
            });
    } else {
        // User is signed out
        currentUser = null;
        document.getElementById('register-screen').style.display = 'flex';
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('app-container').style.display = 'none';
    }
});

// Show main app
function showApp() {
    document.getElementById('register-screen').style.display = 'none';
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-container').style.display = 'flex';
    initializeApp(currentUser);
    updateProfileInfo();
}

// Initialize App
function initializeApp(user) {
    currentUser = user;
    loadUsers();
    setupPresence();
}

// Sign Out
function signOut() {
    cleanupPresence();
    auth.signOut().then(() => {
        window.location.reload();
    }).catch((error) => {
        console.error("Error signing out:", error);
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
    if (!usersList) {
        console.error('Chat list element not found');
        return;
    }

    // Reference to users in Firebase
    const usersRef = firebase.database().ref('users');

    // Keep track of user elements by ID
    const userElements = {};

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
            updateUser(user);
        }
    });

    // Listen for user updates
    usersRef.on('child_changed', (snapshot) => {
        const user = snapshot.val();
        if (user.id !== currentUser.id) {
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
        }
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
            <div class="user-avatar">
                <img src="${userData.photoURL || `https://ui-avatars.com/api/?name=${userData.username}&background=00a884&color=fff`}" 
                     alt="${userData.username}">
                <span class="status-indicator ${userData.status === 'online' ? 'online' : 'offline'}"></span>
            </div>
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
    
    div.innerHTML = `
        <div class="message-content">
            <p class="message-text">${message.text}</p>
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
        timestamp: Date.now(),
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
        });
}

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
        }, 3000);
        
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

    const userStatusRef = firebase.database().ref(`users/${currentUser.id}`);
    const connectedRef = firebase.database().ref('.info/connected');

    // Set initial online status when page loads
    userStatusRef.update({
        status: 'online',
        lastSeen: firebase.database.ServerValue.TIMESTAMP
    });

    // Handle real-time connection state
    connectedRef.on('value', (snap) => {
        if (snap.val() === true) {
            // User is connected
            userStatusRef.update({
                status: 'online',
                lastSeen: firebase.database.ServerValue.TIMESTAMP
            });

            // When user disconnects
            userStatusRef.onDisconnect().update({
                status: 'offline',
                lastSeen: firebase.database.ServerValue.TIMESTAMP
            });
        }
    });

    // Handle tab visibility
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            userStatusRef.update({
                status: 'online',
                lastSeen: firebase.database.ServerValue.TIMESTAMP
            });
        }
    });

    // Handle page unload
    window.addEventListener('beforeunload', () => {
        // Synchronous update for immediate status change
        fetch(`${YOUR_API_ENDPOINT}/updateStatus`, {
            method: 'POST',
            keepalive: true,
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                userId: currentUser.id,
                status: 'offline',
                lastSeen: Date.now()
            })
        });
    });

    // Listen to status changes for all users
    firebase.database().ref('users').on('value', (snapshot) => {
        snapshot.forEach((userSnapshot) => {
            const user = userSnapshot.val();
            updateUserStatusUI(user.id, user.status, user.lastSeen);
        });
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
    const div = document.createElement('div');
    div.className = 'chat-item';
    
    const unreadCount = chat.unreadCount || 0;
    const isUnread = unreadCount > 0 && chat.lastMessageSender !== currentUser.id;

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

    div.addEventListener('click', () => {
        selectChat(chat);
        markChatAsRead(chat.id);
    });

    return div;
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
    constructor(chatList) {
        this.searchInput = document.querySelector('.search-input');
        this.chatList = chatList;
        this.clearButton = document.querySelector('.search-clear');
        this.searchIndex = new Map();
        this.init();
    }

    init() {
        this.bindEvents();
        this.updateSearchIndex();
    }

    bindEvents() {
        this.searchInput.addEventListener('input', () => {
            const searchTerm = this.searchInput.value.trim().toLowerCase();
            this.performSearch(searchTerm);
        });

        if (this.clearButton) {
            this.clearButton.addEventListener('click', () => {
                this.clearSearch();
            });
        }
    }

    updateSearchIndex() {
        this.searchIndex.clear();
        document.querySelectorAll('.chat-item').forEach(chat => {
            const chatId = chat.dataset.chatId;
            const searchableText = this.getSearchableText(chat).toLowerCase();
            this.searchIndex.set(chatId, {
                element: chat,
                searchableText: searchableText
            });
        });
    }

    getSearchableText(chatElement) {
        const name = chatElement.querySelector('.chat-name')?.textContent || '';
        const message = chatElement.querySelector('.chat-last-message')?.textContent || '';
        const email = chatElement.querySelector('.chat-email')?.textContent || '';
        return `${name} ${message} ${email}`;
    }

    performSearch(searchTerm) {
        Array.from(this.chatList.children).forEach(chat => {
            chat.style.display = 'none';
        });

        if (!searchTerm) {
            this.showAllChats();
            return;
        }

        let hasResults = false;
        this.searchIndex.forEach((data, chatId) => {
            if (data.searchableText.includes(searchTerm)) {
                const chatElement = document.querySelector(`[data-chat-id="${chatId}"]`);
                if (chatElement) {
                    this.highlightSearchTerm(chatElement, searchTerm);
                    chatElement.style.display = 'flex';
                    hasResults = true;
                }
            }
        });

        if (!hasResults) {
            this.showNoResults(searchTerm);
        }
    }

    showAllChats() {
        Array.from(this.chatList.children).forEach(chat => {
            chat.style.display = 'flex';
            // Remove any existing highlights
            this.removeHighlights(chat);
        });
    }

    highlightSearchTerm(chatElement, searchTerm) {
        const elements = [
            chatElement.querySelector('.chat-name'),
            chatElement.querySelector('.chat-last-message'),
            chatElement.querySelector('.chat-email')
        ];

        elements.forEach(element => {
            if (element) {
                const text = element.textContent;
                const regex = new RegExp(`(${searchTerm})`, 'gi');
                element.innerHTML = text.replace(regex, '<span class="highlight">$1</span>');
            }
        });
    }

    removeHighlights(chatElement) {
        const highlightedElements = chatElement.querySelectorAll('.highlight');
        highlightedElements.forEach(element => {
            const parent = element.parentNode;
            parent.textContent = parent.textContent;
        });
    }

    showNoResults(searchTerm) {
        const noResults = document.createElement('div');
        noResults.className = 'no-results';
        noResults.innerHTML = `
            <div class="no-results-content">
                <i class="fas fa-search"></i>
                <p>No results found for "${searchTerm}"</p>
                <span class="no-results-tip">Try searching for:</span>
                <ul class="search-tips">
                    <li>• Contact names</li>
                    <li>• Messages</li>
                    <li>• Email addresses</li>
                </ul>
            </div>
        `;
        this.chatList.appendChild(noResults);
    }

    clearSearch() {
        this.searchInput.value = '';
        this.showAllChats();
        this.searchInput.focus();
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Add search container if not present
    if (!document.querySelector('.search-container')) {
        const searchContainer = document.createElement('div');
        searchContainer.className = 'search-container';
        searchContainer.innerHTML = `
            <div class="search-box">
                <i class="fas fa-search search-icon"></i>
                <input type="text" class="search-input" placeholder="Search or start new chat">
                <i class="fas fa-times search-clear"></i>
            </div>
        `;
        document.querySelector('.chat-list-container').insertBefore(
            searchContainer,
            document.querySelector('.chat-list')
        );
    }

    // Initialize search
    const chatSearch = new ChatSearch();

    // Example of adding new chats dynamically
    window.addNewChat = function(chatData) {
        const chatItem = createChatItem(chatData);
        document.querySelector('.chat-list').appendChild(chatItem);
        chatSearch.updateSearchIndex();
    };
});

function createChatItem(data) {
    const div = document.createElement('div');
    div.className = 'chat-item';
    div.innerHTML = `
        <div class="chat-avatar">${data.name.charAt(0)}</div>
        <div class="chat-details">
            <div class="chat-header">
                <span class="chat-name">${data.name}</span>
                <span class="chat-time">${data.time || '12:00 PM'}</span>
            </div>
            <div class="chat-info">
                <span class="chat-last-message">${data.lastMessage || ''}</span>
                <span class="chat-email">${data.email || ''}</span>
            </div>
        </div>
    `;
    return div;
}

class ChatManager {
    constructor() {
        this.db = firebase.firestore();
        this.chatList = document.querySelector('.chat-list');
        this.searchManager = new ChatSearch(this.chatList);
        this.setupRealtimeListeners();
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
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const chatManager = new ChatManager();
}); 