// Authentication Logic
console.log('Auth.js loaded'); // Debug
console.log('Storage available:', typeof Storage !== 'undefined'); // Debug
console.log('API available:', typeof API !== 'undefined'); // Debug

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing auth...'); // Debug
    
    // Check if already authenticated
    if (Storage.isAuthenticated()) {
        window.location.href = 'dashboard.html';
        return;
    }
    
    // Get URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const mode = urlParams.get('mode') || 'login';
    
    // Initialize form based on mode
    initAuthForms(mode);
    
    // Tab switching
    setupTabSwitching();
    
    // Form submissions
    setupLoginForm();
    setupSignupForm();
});

function initAuthForms(mode) {
    const loginTab = document.getElementById('login-tab');
    const signupTab = document.getElementById('signup-tab');
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');
    
    if (mode === 'signup') {
        showSignupForm();
    } else {
        showLoginForm();
    }
}

function setupTabSwitching() {
    const loginTab = document.getElementById('login-tab');
    const signupTab = document.getElementById('signup-tab');
    const showSignup = document.getElementById('show-signup');
    const showLogin = document.getElementById('show-login');
    
    loginTab.addEventListener('click', showLoginForm);
    signupTab.addEventListener('click', showSignupForm);
    showSignup?.addEventListener('click', (e) => {
        e.preventDefault();
        showSignupForm();
    });
    showLogin?.addEventListener('click', (e) => {
        e.preventDefault();
        showLoginForm();
    });
}

function showLoginForm() {
    const loginTab = document.getElementById('login-tab');
    const signupTab = document.getElementById('signup-tab');
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');
    
    loginTab.classList.add('active');
    signupTab.classList.remove('active');
    loginForm.classList.remove('hidden');
    signupForm.classList.add('hidden');
    setAuthVisualState('login');
    
    // Update URL
    history.pushState({}, '', 'auth.html?mode=login');
}

function showSignupForm() {
    const loginTab = document.getElementById('login-tab');
    const signupTab = document.getElementById('signup-tab');
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');
    
    signupTab.classList.add('active');
    loginTab.classList.remove('active');
    signupForm.classList.remove('hidden');
    loginForm.classList.add('hidden');
    setAuthVisualState('signup');
    
    // Update URL
    history.pushState({}, '', 'auth.html?mode=signup');
}

function setAuthVisualState(mode) {
    const heading = document.getElementById('auth-heading');
    const subheading = document.getElementById('auth-subheading');
    const visualTitle = document.getElementById('auth-visual-title');
    const visualSubtitle = document.getElementById('auth-visual-subtitle');

    if (mode === 'signup') {
        if (heading) heading.textContent = 'Create your account';
        if (subheading) subheading.textContent = 'Start with your details and unlock personalized interview prep.';
        if (visualTitle) visualTitle.textContent = 'Build your job-winning profile';
        if (visualSubtitle) visualSubtitle.textContent = 'Set up once, then practice with AI interviews, ATS scoring, and JD match insights.';
        document.body.setAttribute('data-auth-mode', 'signup');
        return;
    }

    if (heading) heading.textContent = 'Welcome back';
    if (subheading) subheading.textContent = 'Please enter your details to continue your interview prep journey.';
    if (visualTitle) visualTitle.textContent = 'Continue your prep streak';
    if (visualSubtitle) visualSubtitle.textContent = 'AI interviews, ATS checks, and JD matching — all in one focused workflow.';
    document.body.setAttribute('data-auth-mode', 'login');
}

function setupLoginForm() {
    const loginForm = document.getElementById('login-form');
    const loginError = document.getElementById('login-error');
    
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        const rememberMe = document.getElementById('remember-me').checked;
        
        // Disable submit button
        const submitBtn = loginForm.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.classList.add('loading');
        
        // Clear previous errors
        loginError.classList.add('hidden');
        
        try {
            const response = await API.login(email, password);
            
            if (response.success) {
                // Store remember me preference
                if (rememberMe) {
                    localStorage.setItem('hirewise_remember', 'true');
                }
                
                // Show success and redirect
                showNotification('Login successful! Redirecting...', 'success');
                setTimeout(() => {
                    window.location.href = 'dashboard.html';
                }, 1000);
            } else {
                loginError.textContent = response.message;
                loginError.classList.remove('hidden');
            }
        } catch (error) {
            loginError.textContent = 'An error occurred. Please try again.';
            loginError.classList.remove('hidden');
        } finally {
            submitBtn.disabled = false;
            submitBtn.classList.remove('loading');
        }
    });
}

function setupSignupForm() {
    const signupForm = document.getElementById('signup-form');
    const signupError = document.getElementById('signup-error');
    
    // Password matching validation
    const password = document.getElementById('signup-password');
    const confirmPassword = document.getElementById('signup-confirm-password');
    
    confirmPassword.addEventListener('input', () => {
        if (password.value !== confirmPassword.value) {
            confirmPassword.setCustomValidity('Passwords do not match');
        } else {
            confirmPassword.setCustomValidity('');
        }
    });
    
    signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        // Get password values
        const password = document.getElementById('signup-password').value;
        const confirmPassword = document.getElementById('signup-confirm-password').value;
        
        // Check password match
        if (password !== confirmPassword) {
            signupError.textContent = 'Passwords do not match';
            signupError.classList.remove('hidden');
            return;
        }
        
        // Collect form data
        const formData = {
            fullName: document.getElementById('signup-fullname').value,
            email: document.getElementById('signup-email').value,
            password: password, // Add password to formData
            phone: document.getElementById('signup-phone').value,
            linkedinUrl: document.getElementById('signup-linkedin').value,
            education: [{
                degree: document.getElementById('signup-degree').value,
                field: document.getElementById('signup-field').value,
                university: document.getElementById('signup-university').value,
                graduationYear: parseInt(document.getElementById('signup-year').value)
            }]
        };
        
        // Handle resume file
        const resumeFile = document.getElementById('signup-resume').files[0];
        if (resumeFile) {
            try {
                const resumeData = await Storage.fileToBase64(resumeFile);
                formData.resume = {
                    file: resumeData,
                    fileName: resumeFile.name,
                    fileType: resumeFile.type,
                    uploadedDate: new Date().toISOString()
                };
            } catch (error) {
                signupError.textContent = 'Error uploading resume. Please try again.';
                signupError.classList.remove('hidden');
                return;
            }
        }
        
        // Disable submit button
        const submitBtn = signupForm.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.classList.add('loading');
        
        // Clear previous errors
        signupError.classList.add('hidden');
        
        try {
            const response = await API.signup(formData);
            
            console.log('Signup response:', response); // Debug log
            
            if (response.success) {
                // Upload resume to backend if provided
                const resumeFileInput = document.getElementById('signup-resume');
                const resumeFileToUpload = resumeFileInput?.files[0];
                if (resumeFileToUpload) {
                    try {
                        showNotification('Uploading resume...', 'info');
                        await API.checkATS(resumeFileToUpload);
                        console.log('Resume uploaded successfully during signup');
                    } catch (uploadError) {
                        console.error('Resume upload failed during signup:', uploadError);
                        // Don't block signup - resume can be uploaded later
                    }
                }
                
                // Show success and redirect
                showNotification('Account created successfully! Redirecting...', 'success');
                setTimeout(() => {
                    window.location.href = 'dashboard.html';
                }, 1500);
            } else {
                signupError.textContent = response.message;
                signupError.classList.remove('hidden');
            }
        } catch (error) {
            console.error('Signup error:', error); // Debug log
            signupError.textContent = 'An error occurred: ' + error.message;
            signupError.classList.remove('hidden');
        } finally {
            submitBtn.disabled = false;
            submitBtn.classList.remove('loading');
        }
    });
}

// Utility: Show notification
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <div class="flex items-center gap-3">
            <span>${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span>
            <span>${message}</span>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.opacity = '0';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Form validation helpers
function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

function validatePhone(phone) {
    const re = /^[\d\s\-\+\(\)]+$/;
    return re.test(phone) && phone.replace(/\D/g, '').length >= 10;
}

function validatePassword(password) {
    return password.length >= 8;
}
