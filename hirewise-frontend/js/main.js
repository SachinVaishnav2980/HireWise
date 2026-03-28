// Landing Page Scripts
document.addEventListener('DOMContentLoaded', () => {
    initSmoothScroll();
    initMobileMenu();
    initFeatureCards();
    initScrollProgress();
    initSectionReveal();
    initNavActiveTracking();
    loadTestimonials();
});

// Smooth Scrolling
function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            const href = this.getAttribute('href');
            if (href === '#' || href === '#!') return;
            
            const target = document.querySelector(href);
            if (target) {
                e.preventDefault();
                
                // Calculate offset for fixed navbar
                const navbarHeight = 80;
                const targetPosition = target.getBoundingClientRect().top + window.pageYOffset - navbarHeight;
                
                window.scrollTo({
                    top: targetPosition,
                    behavior: 'smooth'
                });
            }
        });
    });
}

// Mobile Menu
function initMobileMenu() {
    const menuButton = document.getElementById('mobile-menu-btn');
    const mobileMenu = document.getElementById('mobile-menu');
    
    if (!menuButton || !mobileMenu) return;
    
    menuButton.addEventListener('click', () => {
        mobileMenu.classList.toggle('hidden');
    });
    
    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
        if (!menuButton.contains(e.target) && !mobileMenu.contains(e.target)) {
            mobileMenu.classList.add('hidden');
        }
    });
}

// Feature Cards Animation on Scroll
function initFeatureCards() {
    const cards = document.querySelectorAll('.feature-card');
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '0';
                entry.target.style.transform = 'translateY(20px)';
                
                setTimeout(() => {
                    entry.target.style.transition = 'all 0.6s ease';
                    entry.target.style.opacity = '1';
                    entry.target.style.transform = 'translateY(0)';
                }, 100);
                
                observer.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.1
    });
    
    cards.forEach(card => observer.observe(card));
}

// Scroll Progress Indicator
function initScrollProgress() {
    const progressBar = document.getElementById('scroll-progress');
    if (!progressBar) return;
    
    window.addEventListener('scroll', () => {
        const windowHeight = window.innerHeight;
        const documentHeight = document.documentElement.scrollHeight - windowHeight;
        const scrolled = window.scrollY;
        const progress = (scrolled / documentHeight) * 100;
        
        progressBar.style.width = progress + '%';
    });
}

// Check authentication status
function checkAuthStatus() {
    if (Storage && Storage.isAuthenticated()) {
        // User is logged in, update UI if needed
        const loginBtn = document.querySelector('a[href="auth.html?mode=login"]');
        const signupBtn = document.querySelector('a[href="auth.html?mode=signup"]');
        
        if (loginBtn) {
            loginBtn.textContent = 'Dashboard';
            loginBtn.href = 'dashboard.html';
        }
        
        if (signupBtn) {
            signupBtn.classList.add('hidden');
        }
    }
}

// Initialize on load
checkAuthStatus();

// ---- Section Reveal on Scroll ----
function initSectionReveal() {
    const sections = document.querySelectorAll('section');
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('animate-fade-in');
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.08 });

    sections.forEach(s => {
        s.style.opacity = '0';
        observer.observe(s);
    });

    // Make hero visible immediately
    const hero = document.querySelector('section');
    if (hero) { hero.style.opacity = '1'; hero.classList.add('animate-fade-in'); }
}

// ---- Navbar Active Link Tracking ----
function initNavActiveTracking() {
    const navLinks = document.querySelectorAll('nav a[href^="#"]');
    if (!navLinks.length) return;

    const sectionIds = [...navLinks].map(l => l.getAttribute('href').slice(1)).filter(Boolean);
    const sectionEls = sectionIds.map(id => document.getElementById(id)).filter(Boolean);

    function updateActive() {
        let current = '';
        sectionEls.forEach(s => {
            if (window.scrollY >= s.offsetTop - 120) current = s.id;
        });
        navLinks.forEach(l => {
            const href = l.getAttribute('href');
            if (href === '#' + current) {
                l.style.color = '#1F3A5F';
            } else {
                l.style.color = '';
            }
        });
    }

    window.addEventListener('scroll', updateActive, { passive: true });
    updateActive();
}

// Newsletter subscription (mock)
const newsletterForm = document.getElementById('newsletter-form');
if (newsletterForm) {
    newsletterForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = newsletterForm.querySelector('input[type="email"]').value;
        
        // Show success message
        showNotification('Thank you for subscribing!', 'success');
        newsletterForm.reset();
    });
}

// Utility: Show notification
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// Load Testimonials from localStorage
function loadTestimonials() {
    const container = document.getElementById('testimonials-container');
    if (!container) return;
    
    const feedbacks = JSON.parse(localStorage.getItem('hirewise_feedbacks') || '[]');
    
    if (feedbacks.length === 0) {
        container.innerHTML = `
            <div class="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm">
                <div class="flex items-center mb-4">
                    <div class="w-11 h-11 bg-[#1F3A5F]/10 rounded-full flex items-center justify-center text-base font-bold text-[#1F3A5F]">?</div>
                    <div class="ml-3">
                        <div class="font-bold text-[#1E1E1E] text-sm">Your Story Here</div>
                        <div class="text-xs text-[#6B7280]">Be our first success story!</div>
                    </div>
                </div>
                <p class="text-[#6B7280] text-sm italic leading-relaxed">"Complete an interview and share your experience to appear here!"</p>
                <div class="mt-4 text-[#1F3A5F] text-sm">&#9733;&#9733;&#9733;&#9733;&#9733;</div>
            </div>
        `;
        return;
    }
    
    const latestFeedbacks = feedbacks.slice(0, 6);
    
    container.innerHTML = latestFeedbacks.map(feedback => {
        const initials = feedback.name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
        const stars = '&#9733;'.repeat(feedback.rating);
        
        return `
            <div class="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm hover:-translate-y-1 transition-all duration-300">
                <div class="flex items-center mb-4">
                    <div class="w-11 h-11 bg-[#1F3A5F]/10 rounded-full flex items-center justify-center text-base font-bold text-[#1F3A5F]">${initials}</div>
                    <div class="ml-3">
                        <div class="font-bold text-[#1E1E1E] text-sm">${feedback.name}</div>
                        <div class="text-xs text-[#6B7280]">${feedback.title}</div>
                    </div>
                </div>
                <p class="text-[#6B7280] text-sm italic leading-relaxed">"${feedback.text}"</p>
                <div class="mt-4 text-[#1F3A5F] text-sm">${stars}</div>
            </div>
        `;
    }).join('');
}
