// Application Configuration
const AppConfig = {
    // App Info
    appName: 'HireWise',
    version: '1.0.0',
    description: 'AI-Powered Interview Practice Platform',
    
    // API Configuration
    api: {
        baseURL: 'http://localhost:8001/api',
        timeout: 30000,
        retryAttempts: 3
    },
    
    // Feature Flags
    features: {
        interviews: true,
        jdMatcher: true,
        atsChecker: true,
        jobDiscovery: false, // Coming soon
        videoInterview: true,
        speechToText: false, // Phase 2
        bodyLanguageAnalysis: false // Phase 2
    },
    
    // Interview Settings
    interview: {
        defaultQuestionCount: 5,
        maxDuration: 3600, // 60 minutes in seconds
        recordingEnabled: true,
        cameraRequired: false
    },
    
    // Scoring System
    scoring: {
        pointsPerInterview: 100,
        streakBonus: 10,
        perfectScoreBonus: 50,
        levels: [
            { name: 'Beginner', minPoints: 0, color: '#6b7280' },
            { name: 'Intermediate', minPoints: 500, color: '#3b82f6' },
            { name: 'Advanced', minPoints: 1500, color: '#8b5cf6' },
            { name: 'Expert', minPoints: 3000, color: '#f59e0b' },
            { name: 'Master', minPoints: 5000, color: '#00acc1' }
        ]
    },
    
    // Storage Settings
    storage: {
        keyPrefix: 'hirewise_',
        maxResumeSize: 5242880, // 5MB in bytes
        allowedResumeTypes: ['.pdf', '.doc', '.docx']
    },
    
    // UI Settings
    ui: {
        theme: 'dark',
        animationsEnabled: true,
        notificationDuration: 3000,
        colors: {
            primary: '#0a1128',
            primarySecondary: '#1a237e',
            accent: '#00acc1',
            success: '#10b981',
            warning: '#f59e0b',
            error: '#ef4444'
        }
    },
    
    // Analytics (Future)
    analytics: {
        enabled: false,
        trackingId: '',
        events: {
            signUp: 'user_signup',
            login: 'user_login',
            interviewStart: 'interview_start',
            interviewComplete: 'interview_complete',
            jdMatch: 'jd_match_analysis',
            atsCheck: 'ats_check'
        }
    },
    
    // Role Templates
    roles: [
        { id: 'software-engineer', name: 'Software Engineer', icon: '💻' },
        { id: 'data-scientist', name: 'Data Scientist', icon: '📊' },
        { id: 'product-manager', name: 'Product Manager', icon: '📱' },
        { id: 'marketing', name: 'Marketing', icon: '📢' },
        { id: 'general', name: 'General', icon: '💼' }
    ],
    
    // Company Info
    company: {
        name: 'HireWise Inc.',
        email: 'support@hirewise.ai',
        phone: '+1 (555) 123-4567',
        address: 'San Francisco, CA',
        social: {
            twitter: 'https://twitter.com/hirewise',
            linkedin: 'https://linkedin.com/company/hirewise',
            github: 'https://github.com/hirewise'
        }
    },
    
    // Legal
    legal: {
        privacyPolicyUrl: '/privacy-policy.html',
        termsOfServiceUrl: '/terms-of-service.html',
        copyrightYear: new Date().getFullYear()
    },
    
    // Development Settings
    dev: {
        debug: false,
        mockAPI: false,
        logLevel: 'info' // 'debug', 'info', 'warn', 'error'
    }
};

// Freeze config to prevent modifications
Object.freeze(AppConfig);

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AppConfig;
}

// Make available globally
if (typeof window !== 'undefined') {
    window.AppConfig = AppConfig;
}
