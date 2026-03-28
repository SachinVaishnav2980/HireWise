// ATS Compatibility Checker Logic
class ATSChecker {
    constructor() {
        this.currentResult = null;
    }

    openModal() {
        console.log('=== OPEN MODAL CALLED ===');
        
        // Remove any existing modal first
        const existingModal = document.getElementById('ats-checker-modal');
        if (existingModal) {
            console.log('Removing existing modal');
            existingModal.remove();
        }
        
        console.log('Creating new modal...');
        
        const modal = document.createElement('div');
        modal.id = 'ats-checker-modal';
        modal.className = 'modal-backdrop';
        modal.style.display = 'flex'; // Force display
        modal.style.zIndex = '99999'; // Higher than notifications (9999)
        modal.style.position = 'fixed';
        modal.style.top = '0';
        modal.style.left = '0';
        modal.style.width = '100%';
        modal.style.height = '100%';
        
        console.log('Modal element created');
        
        modal.innerHTML = `
            <div class="modal max-w-4xl p-0" style="max-height: 90vh; overflow-y: auto;">
                <div class="modal-header">
                    <h2 class="text-2xl font-bold">ATS Compatibility Checker</h2>
                    <button class="close-modal" onclick="event.stopPropagation(); document.getElementById('ats-checker-modal').remove();">×</button>
                </div>
                <div class="modal-body">
                    <div id="ats-input-section">
                        <div class="text-center mb-6">
                            <div class="text-6xl mb-4">📄</div>
                            <h3 class="text-xl font-bold mb-2">Check Your Resume's ATS Score</h3>
                            <p class="text-gray-400">Upload your resume to see how well it passes Applicant Tracking Systems</p>
                        </div>
                        
                        <div class="space-y-6">
                            <!-- Resume Selection Tabs -->
                            <div class="flex gap-4 border-b border-accent-cyan/20">
                                <button id="upload-new-tab" class="px-4 py-2 border-b-2 border-accent-cyan text-accent-cyan font-semibold" onclick="event.preventDefault(); ATSChecker.instance.switchTab('upload')">
                                    Upload New
                                </button>
                                <button id="use-stored-tab" class="px-4 py-2 border-b-2 border-transparent text-gray-400 hover:text-accent-cyan" onclick="event.preventDefault(); ATSChecker.instance.switchTab('stored')">
                                    Use Stored Resume
                                </button>
                            </div>
                            
                            <!-- Upload New Tab -->
                            <div id="upload-new-content">
                                <div>
                                    <label class="block text-sm font-medium mb-2">Upload Resume</label>
                                    <input type="file" 
                                           id="ats-resume-file"
                                           accept=".pdf,.doc,.docx"
                                           class="w-full px-4 py-3 bg-primary-dark border border-accent-cyan/30 rounded-lg focus:outline-none focus:border-accent-cyan text-white file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-accent-cyan/20 file:text-accent-cyan hover:file:bg-accent-cyan/30">
                                </div>
                            </div>
                            
                            <!-- Stored Resume Tab -->
                            <div id="use-stored-content" class="hidden">
                                <div>
                                    <label class="block text-sm font-medium mb-2">Select Resume</label>
                                    <select id="stored-resume-select" 
                                            class="w-full px-4 py-3 bg-primary-dark border border-accent-cyan/30 rounded-lg focus:outline-none focus:border-accent-cyan text-white">
                                        <option value="">Loading resumes...</option>
                                    </select>
                                </div>
                            </div>
                            
                            <div class="bg-accent-cyan/10 border border-accent-cyan/30 rounded-lg p-4">
                                <p class="text-sm text-gray-300">
                                    💡 <strong>Tip:</strong> ATS systems scan for specific keywords, formatting, and structure. 
                                    Our checker will analyze your resume and provide actionable suggestions to improve visibility.
                                </p>
                            </div>
                            
                            <div class="flex gap-4">
                                <button type="button" onclick="event.preventDefault(); event.stopPropagation(); ATSChecker.instance.checkATS(event); return false;" 
                                        class="flex-1 px-6 py-3 bg-accent-cyan text-white rounded-lg hover:bg-accent-cyan/90 transition">
                                    Check ATS Score
                                </button>
                            </div>
                        </div>
                    </div>
                    
                    <div id="ats-results-section" class="hidden">
                        <div id="ats-results-content"></div>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        console.log('Modal appended to body');
        
        // Prevent modal from closing when clicking inside it
        const modalContent = modal.querySelector('.modal');
        if (modalContent) {
            modalContent.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }
        
        // Close modal when clicking on backdrop (outside modal content)
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                console.log('Backdrop clicked - closing modal');
                modal.remove();
            }
        });
        
        // Load stored resumes
        this.loadStoredResumes();
        
        console.log('=== MODAL OPENED SUCCESSFULLY ===');
        console.log('Modal added to body:', !!document.getElementById('ats-checker-modal'));
    }

    switchTab(tab) {
        const uploadTab = document.getElementById('upload-new-tab');
        const storedTab = document.getElementById('use-stored-tab');
        const uploadContent = document.getElementById('upload-new-content');
        const storedContent = document.getElementById('use-stored-content');
        
        if (tab === 'upload') {
            uploadTab.classList.add('border-accent-cyan', 'text-accent-cyan', 'font-semibold');
            uploadTab.classList.remove('border-transparent', 'text-gray-400');
            storedTab.classList.remove('border-accent-cyan', 'text-accent-cyan', 'font-semibold');
            storedTab.classList.add('border-transparent', 'text-gray-400');
            uploadContent.classList.remove('hidden');
            storedContent.classList.add('hidden');
        } else {
            storedTab.classList.add('border-accent-cyan', 'text-accent-cyan', 'font-semibold');
            storedTab.classList.remove('border-transparent', 'text-gray-400');
            uploadTab.classList.remove('border-accent-cyan', 'text-accent-cyan', 'font-semibold');
            uploadTab.classList.add('border-transparent', 'text-gray-400');
            storedContent.classList.remove('hidden');
            uploadContent.classList.add('hidden');
        }
    }

    async loadStoredResumes() {
        const select = document.getElementById('stored-resume-select');
        if (!select) return;
        
        const response = await API.getUserResumes();
        
        if (response.success && response.data && response.data.length > 0) {
            select.innerHTML = '<option value="">-- Select a resume --</option>' +
                response.data.map(resume => 
                    `<option value="${resume.resumeId}">${resume.fileName} (${new Date(resume.uploadedAt).toLocaleDateString()})</option>`
                ).join('');
        } else {
            select.innerHTML = '<option value="">No resumes found. Please upload one first.</option>';
        }
    }

    async checkATS(event) {
        // Prevent any default behavior or propagation
        if (event) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
        }
        
        console.log('=== CHECK ATS CALLED ===');
        
        const uploadContent = document.getElementById('upload-new-content');
        const storedContent = document.getElementById('use-stored-content');
        
        let response;
        
        // Check which tab is active
        if (!uploadContent.classList.contains('hidden')) {
            // Upload new resume
            const fileInput = document.getElementById('ats-resume-file');
            const file = fileInput?.files[0];
            
            if (!file) {
                this.showInlineNotification('Please upload a resume file', 'warning');
                return false;
            }
            
            // Validate file type
            if (!file.name.toLowerCase().endsWith('.pdf')) {
                this.showInlineNotification('Please upload a PDF file only', 'warning');
                return false;
            }
            
            // Validate file size (5MB max)
            if (file.size > 5 * 1024 * 1024) {
                this.showInlineNotification('File size must be less than 5MB', 'warning');
                return false;
            }
            
            // Show loading
            const inputSection = document.getElementById('ats-input-section');
            inputSection.innerHTML = '<div class="text-center py-12"><div class="spinner mx-auto"></div><p class="mt-4 text-gray-400">Analyzing resume... This may take 10-20 seconds.</p></div>';
            
            try {
                console.log('Checking ATS for file:', file.name);
                response = await API.checkATS(file);
                console.log('ATS Response:', response);
            } catch (error) {
                console.error('Error checking ATS:', error);
                this.showError('Failed to analyze resume. Please check your backend server is running on port 8001.');
                return false;
            }
        } else {
            // Use stored resume
            const select = document.getElementById('stored-resume-select');
            const resumeId = select?.value;
            
            if (!resumeId) {
                this.showInlineNotification('Please select a resume', 'warning');
                return false;
            }
            
            // Show loading
            const inputSection = document.getElementById('ats-input-section');
            inputSection.innerHTML = '<div class="text-center py-12"><div class="spinner mx-auto"></div><p class="mt-4 text-gray-400">Analyzing stored resume... This may take 10-20 seconds.</p></div>';
            
            try {
                console.log('Checking ATS for stored resume:', resumeId);
                response = await API.checkATSStored(resumeId);
                console.log('ATS Response:', response);
            } catch (error) {
                console.error('Error checking ATS:', error);
                this.showError('Failed to analyze resume. Please try again.');
                return false;
            }
        }
        
        // Handle response
        if (response && response.success) {
            this.currentResult = response.data;
            this.showResults();
        } else {
            this.showError(response?.message || 'Failed to analyze resume. Please check backend logs for details.');
        }
        
        return false; // Prevent any further event propagation
    }

    showError(message) {
        const inputSection = document.getElementById('ats-input-section');
        inputSection.innerHTML = `
            <div class="text-center py-12">
                <div class="text-6xl mb-4">❌</div>
                <h3 class="text-xl font-bold text-red-500 mb-4">Analysis Failed</h3>
                <p class="text-gray-300 mb-6 max-w-md mx-auto">${message}</p>
                <div class="space-y-3 text-left max-w-md mx-auto bg-primary-dark p-4 rounded-lg mb-6">
                    <p class="text-sm text-gray-400 font-semibold">Common Issues:</p>
                    <ul class="text-sm text-gray-300 space-y-2">
                        <li>• Backend server not running (run start_server.bat)</li>
                        <li>• PDF file is corrupted or password-protected</li>
                        <li>• MongoDB not running on localhost:27017</li>
                        <li>• Gemini API key not configured in .env file</li>
                    </ul>
                </div>
                <button onclick="ATSChecker.instance.reset()" 
                        class="px-6 py-3 bg-accent-cyan text-white rounded-lg hover:bg-accent-cyan/90 transition">
                    Try Again
                </button>
            </div>
        `;
    }

    showInlineNotification(message, type = 'info') {
        // Create inline notification within modal
        const modal = document.getElementById('ats-checker-modal');
        if (!modal) return;
        
        const notification = document.createElement('div');
        notification.className = `inline-notification ${type}`;
        notification.style.cssText = `
            position: absolute;
            top: 80px;
            left: 50%;
            transform: translateX(-50%);
            padding: 1rem 1.5rem;
            background-color: ${type === 'error' ? '#dc2626' : type === 'warning' ? '#f59e0b' : '#10b981'};
            color: white;
            border-radius: 0.5rem;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
            z-index: 100000;
            animation: slide-down 0.3s ease;
            max-width: 500px;
        `;
        notification.textContent = message;
        
        modal.appendChild(notification);
        
        setTimeout(() => {
            notification.style.animation = 'fade-out 0.3s ease';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    showResults() {
        console.log('=== ATS SHOW RESULTS ===');
        console.log('Current result:', this.currentResult);
        
        const inputSection = document.getElementById('ats-input-section');
        const resultsSection = document.getElementById('ats-results-section');
        const resultsContent = document.getElementById('ats-results-content');
        
        if (!inputSection || !resultsSection || !resultsContent) {
            console.error('Required elements not found!');
            return;
        }
        
        const result = this.currentResult;
        const scoreColor = result.overallScore >= 80 ? 'text-green-500' : 
                          result.overallScore >= 60 ? 'text-yellow-500' : 'text-red-500';
        
        console.log('Rendering results with atsId:', result.atsId);
        
        resultsContent.innerHTML = `
            <!-- Overall Score -->
            <div class="text-center mb-8">
                <div class="score-circle mx-auto border-8" style="border-color: ${scoreColor.replace('text-', '')}; width: 150px; height: 150px; border-radius: 50%; display: flex; align-items: center; justify-content: center;">
                    <span class="${scoreColor}" style="font-size: 2.5rem; font-weight: bold;">${result.overallScore}%</span>
                </div>
                <h3 class="text-2xl font-bold mt-4">ATS Compatibility Score</h3>
                <p class="text-gray-400">
                    ${result.overallScore >= 80 ? 'Excellent! Your resume is ATS-friendly' :
                      result.overallScore >= 60 ? 'Good, but there\'s room for improvement' :
                      'Needs improvement to pass ATS systems'}
                </p>
            </div>
            
            <!-- Metrics Breakdown -->
            <div class="ats-results space-y-4">
                <h3 class="text-xl font-bold mb-4 text-accent-cyan">Detailed Metrics</h3>
                
                <div class="ats-metric">
                    <div class="flex-1">
                        <div class="flex justify-between mb-2">
                            <span class="font-semibold">Formatting</span>
                            <span class="text-accent-cyan font-bold">${result.metrics.formatting}%</span>
                        </div>
                        <div class="progress-bar" style="width: 100%; height: 8px; background-color: rgba(226,232,240,0.5); border-radius: 4px; overflow: hidden;">
                            <div class="progress-fill" style="width: ${result.metrics.formatting}%; height: 100%; background: #1F3A5F; transition: width 0.5s ease;"></div>
                        </div>
                    </div>
                </div>
                
                <div class="ats-metric">
                    <div class="flex-1">
                        <div class="flex justify-between mb-2">
                            <span class="font-semibold">Keywords</span>
                            <span class="text-accent-cyan font-bold">${result.metrics.keywords}%</span>
                        </div>
                        <div class="progress-bar" style="width: 100%; height: 8px; background-color: rgba(226,232,240,0.5); border-radius: 4px; overflow: hidden;">
                            <div class="progress-fill" style="width: ${result.metrics.keywords}%; height: 100%; background: #1F3A5F; transition: width 0.5s ease;"></div>
                        </div>
                    </div>
                </div>
                
                <div class="ats-metric">
                    <div class="flex-1">
                        <div class="flex justify-between mb-2">
                            <span class="font-semibold">Readability</span>
                            <span class="text-accent-cyan font-bold">${result.metrics.readability}%</span>
                        </div>
                        <div class="progress-bar" style="width: 100%; height: 8px; background-color: rgba(226,232,240,0.5); border-radius: 4px; overflow: hidden;">
                            <div class="progress-fill" style="width: ${result.metrics.readability}%; height: 100%; background: #1F3A5F; transition: width 0.5s ease;"></div>
                        </div>
                    </div>
                </div>
                
                <div class="ats-metric">
                    <div class="flex-1">
                        <div class="flex justify-between mb-2">
                            <span class="font-semibold">Structure</span>
                            <span class="text-accent-cyan font-bold">${result.metrics.structure}%</span>
                        </div>
                        <div class="progress-bar" style="width: 100%; height: 8px; background-color: rgba(226,232,240,0.5); border-radius: 4px; overflow: hidden;">
                            <div class="progress-fill" style="width: ${result.metrics.structure}%; height: 100%; background: #1F3A5F; transition: width 0.5s ease;"></div>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Suggestions -->
            <div class="mt-8">
                <h3 class="text-xl font-bold mb-4 text-accent-cyan">Improvement Suggestions</h3>
                <div class="space-y-3">
                    ${result.suggestions.map((suggestion, index) => `
                        <div class="flex items-start gap-3 p-4 bg-primary-dark rounded-lg border border-accent-cyan/20">
                            <div class="w-8 h-8 bg-accent-cyan/20 rounded-full flex items-center justify-center flex-shrink-0">
                                <span class="text-accent-cyan font-bold">${index + 1}</span>
                            </div>
                            <p class="text-gray-300">${suggestion}</p>
                        </div>
                    `).join('')}
                </div>
            </div>
            
            <!-- Actions -->
            <div class="flex gap-4 mt-8">
                ${result.atsId ? `
                    <button onclick="event.preventDefault(); ATSChecker.instance.downloadReport()" 
                            class="flex-1 px-6 py-3 bg-accent-cyan text-white rounded-lg hover:bg-accent-cyan/90 transition flex items-center justify-center gap-2">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                        </svg>
                        Download DOCX Report
                    </button>
                ` : `
                    <button disabled
                            class="flex-1 px-6 py-3 bg-gray-700 text-gray-400 rounded-lg cursor-not-allowed">
                        Report Not Available
                    </button>
                `}
                <button onclick="event.preventDefault(); ATSChecker.instance.reset()" 
                        class="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition">
                    Check Another Resume
                </button>
                <button onclick="event.preventDefault(); document.getElementById('ats-checker-modal').remove()" 
                        class="px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition">
                    Close
                </button>
            </div>
        `;
        
        // Hide input section and show results
        inputSection.classList.add('hidden');
        resultsSection.classList.remove('hidden');
        
        console.log('Results displayed successfully');
        
        // Log activity to calendar
        if (typeof window.logCalendarActivity === 'function') {
            try {
                window.logCalendarActivity('ats_check', 'ATS Resume Check', {
                    description: `ATS compatibility check completed with score: ${result.overallScore}%`,
                    score: result.overallScore,
                    reference_id: result.atsId,
                    status: 'completed'
                });
            } catch (error) {
                console.error('Error logging to calendar:', error);
            }
        }
    }

    reset() {
        const inputSection = document.getElementById('ats-input-section');
        const resultsSection = document.getElementById('ats-results-section');
        
        resultsSection.classList.add('hidden');
        inputSection.classList.remove('hidden');
        
        // Recreate input section
        inputSection.innerHTML = `
            <div class="text-center mb-6">
                <div class="text-6xl mb-4">📄</div>
                <h3 class="text-xl font-bold mb-2">Check Your Resume's ATS Score</h3>
                <p class="text-gray-400">Upload your resume to see how well it passes Applicant Tracking Systems</p>
            </div>
            
            <div class="space-y-6">
                <!-- Resume Selection Tabs -->
                <div class="flex gap-4 border-b border-accent-cyan/20">
                    <button id="upload-new-tab" class="px-4 py-2 border-b-2 border-accent-cyan text-accent-cyan font-semibold" onclick="event.preventDefault(); ATSChecker.instance.switchTab('upload')">
                        Upload New
                    </button>
                    <button id="use-stored-tab" class="px-4 py-2 border-b-2 border-transparent text-gray-400 hover:text-accent-cyan" onclick="event.preventDefault(); ATSChecker.instance.switchTab('stored')">
                        Use Stored Resume
                    </button>
                </div>
                
                <!-- Upload New Tab -->
                <div id="upload-new-content">
                    <div>
                        <label class="block text-sm font-medium mb-2">Upload Resume</label>
                        <input type="file" 
                               id="ats-resume-file"
                               accept=".pdf,.doc,.docx"
                               class="w-full px-4 py-3 bg-primary-dark border border-accent-cyan/30 rounded-lg focus:outline-none focus:border-accent-cyan text-white file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-accent-cyan/20 file:text-accent-cyan hover:file:bg-accent-cyan/30">
                    </div>
                </div>
                
                <!-- Stored Resume Tab -->
                <div id="use-stored-content" class="hidden">
                    <div>
                        <label class="block text-sm font-medium mb-2">Select Resume</label>
                        <select id="stored-resume-select" 
                                class="w-full px-4 py-3 bg-primary-dark border border-accent-cyan/30 rounded-lg focus:outline-none focus:border-accent-cyan text-white">
                            <option value="">Loading resumes...</option>
                        </select>
                    </div>
                </div>
                
                <div class="bg-accent-cyan/10 border border-accent-cyan/30 rounded-lg p-4">
                    <p class="text-sm text-gray-300">
                        💡 <strong>Tip:</strong> ATS systems scan for specific keywords, formatting, and structure. 
                        Our checker will analyze your resume and provide actionable suggestions to improve visibility.
                    </p>
                </div>
                
                <div class="flex gap-4">
                    <button type="button" onclick="event.preventDefault(); event.stopPropagation(); ATSChecker.instance.checkATS(event); return false;" 
                            class="flex-1 px-6 py-3 bg-accent-cyan text-white rounded-lg hover:bg-accent-cyan/90 transition">
                        Check ATS Score
                    </button>
                </div>
            </div>
        `;
        
        this.currentResult = null;
        this.loadStoredResumes();
    }

    downloadReport() {
        if (!this.currentResult) {
            this.showInlineNotification('No report available', 'error');
            return;
        }
        
        // Check if we have atsId from backend
        if (this.currentResult.atsId) {
            // Download DOCX report from backend
            const downloadUrl = `${API.baseURL}/ats/download/${this.currentResult.atsId}`;
            
            fetch(downloadUrl)
                .then(response => {
                    if (!response.ok) {
                        throw new Error('Failed to download report');
                    }
                    return response.blob();
                })
                .then(blob => {
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `ats_report_${Date.now()}.docx`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    this.showInlineNotification('Report downloaded successfully!', 'success');
                })
                .catch(error => {
                    console.error('Error downloading report:', error);
                    this.showInlineNotification('Failed to download report', 'error');
                });
        } else {
            this.showInlineNotification('Report not available. Please try checking ATS again.', 'error');
        }
    }
}

// Create singleton instance
ATSChecker.instance = new ATSChecker();

// Export for use in dashboard
if (typeof window !== 'undefined') {
    window.ATSChecker = ATSChecker;
}
