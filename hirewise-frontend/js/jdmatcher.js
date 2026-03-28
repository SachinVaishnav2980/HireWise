// JD Matcher Logic
class JDMatcher {
    constructor() {
        this.currentMatch = null;
    }

    openModal() {
        // Remove any existing modal first
        const existingModal = document.getElementById('jd-matcher-modal');
        if (existingModal) {
            console.log('Removing existing JD matcher modal');
            existingModal.remove();
        }
        
        const modal = document.createElement('div');
        modal.id = 'jd-matcher-modal';
        modal.className = 'modal-backdrop';
        modal.style.display = 'flex'; // Force display
        modal.style.zIndex = '10000'; // Ensure it's on top
        
        modal.innerHTML = `
            <div class="modal max-w-6xl p-0">
                <div class="modal-header">
                    <h2 class="text-2xl font-bold">Job Description Matcher</h2>
                    <button class="close-modal" onclick="this.closest('.modal-backdrop').remove()">×</button>
                </div>
                <div class="modal-body">
                    <div id="jd-input-section">
                        <div class="space-y-6">
                            <!-- Resume Selection Tabs -->
                            <div>
                                <label class="block text-sm font-medium mb-2">Resume</label>
                                <div class="flex gap-4 border-b border-accent-cyan/20 mb-4">
                                    <button id="jd-upload-new-tab" class="px-4 py-2 border-b-2 border-accent-cyan text-accent-cyan font-semibold" onclick="JDMatcher.instance.switchTab('upload')">
                                        Upload New
                                    </button>
                                    <button id="jd-use-stored-tab" class="px-4 py-2 border-b-2 border-transparent text-gray-400 hover:text-accent-cyan" onclick="JDMatcher.instance.switchTab('stored')">
                                        Use Stored Resume
                                    </button>
                                </div>
                                
                                <!-- Upload New Tab -->
                                <div id="jd-upload-new-content">
                                    <input type="file" 
                                           id="resume-upload-jd"
                                           accept=".pdf,.doc,.docx"
                                           class="w-full px-4 py-3 bg-primary-dark border border-accent-cyan/30 rounded-lg focus:outline-none focus:border-accent-cyan text-white file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-accent-cyan/20 file:text-accent-cyan hover:file:bg-accent-cyan/30">
                                </div>
                                
                                <!-- Stored Resume Tab -->
                                <div id="jd-use-stored-content" class="hidden">
                                    <select id="jd-stored-resume-select" 
                                            class="w-full px-4 py-3 bg-primary-dark border border-accent-cyan/30 rounded-lg focus:outline-none focus:border-accent-cyan text-white">
                                        <option value="">Loading resumes...</option>
                                    </select>
                                </div>
                            </div>
                            
                            <div>
                                <label class="block text-sm font-medium mb-2">Job Description</label>
                                <textarea id="jd-text" 
                                          rows="8"
                                          class="w-full px-4 py-3 bg-primary-dark border border-accent-cyan/30 rounded-lg focus:outline-none focus:border-accent-cyan text-white"
                                          placeholder="Paste the job description here..."></textarea>
                            </div>
                            
                            <div class="flex gap-4">
                                <button onclick="JDMatcher.instance.analyzeMatch()" 
                                        class="flex-1 px-6 py-3 bg-accent-cyan text-white rounded-lg hover:bg-accent-cyan/90 transition">
                                    Analyze Match
                                </button>
                                <button onclick="this.closest('.modal-backdrop').remove()" 
                                        class="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition">
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                    
                    <div id="jd-results-section" class="hidden">
                        <div id="jd-results-content"></div>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Add MutationObserver to detect if modal gets removed
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.removedNodes.forEach((node) => {
                    if (node.id === 'jd-matcher-modal') {
                        console.error('=== JD MATCHER MODAL REMOVED ===');
                        console.trace('Modal removal stack trace:');
                    }
                });
            });
        });
        observer.observe(document.body, { childList: true });
        
        // Prevent modal from closing when clicking inside it
        const modalContent = modal.querySelector('.modal');
        if (modalContent) {
            modalContent.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }
        
        // Load stored resumes
        this.loadStoredResumes();
    }

    switchTab(tab) {
        const uploadTab = document.getElementById('jd-upload-new-tab');
        const storedTab = document.getElementById('jd-use-stored-tab');
        const uploadContent = document.getElementById('jd-upload-new-content');
        const storedContent = document.getElementById('jd-use-stored-content');
        
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
        const select = document.getElementById('jd-stored-resume-select');
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

    async analyzeMatch() {
        const jdText = document.getElementById('jd-text')?.value;
        
        if (!jdText || jdText.trim().length < 50) {
            showNotification('Please provide a job description (minimum 50 characters)', 'warning');
            return;
        }
        
        const uploadContent = document.getElementById('jd-upload-new-content');
        const storedContent = document.getElementById('jd-use-stored-content');
        
        let response;
        
        // Check which tab is active
        if (!uploadContent.classList.contains('hidden')) {
            // Upload new resume
            const resumeFile = document.getElementById('resume-upload-jd')?.files[0];
            
            if (!resumeFile) {
                showNotification('Please upload your resume', 'warning');
                return;
            }
            
            // Validate file type
            if (!resumeFile.name.toLowerCase().endsWith('.pdf')) {
                showNotification('Please upload a PDF file only', 'warning');
                return;
            }
            
            // Validate file size (5MB max)
            if (resumeFile.size > 5 * 1024 * 1024) {
                showNotification('File size must be less than 5MB', 'warning');
                return;
            }
            
            // Show loading
            const inputSection = document.getElementById('jd-input-section');
            inputSection.innerHTML = '<div class="text-center py-12"><div class="spinner mx-auto"></div><p class="mt-4 text-gray-400">Analyzing match... This may take 10-20 seconds.</p></div>';
            
            try {
                console.log('Analyzing JD match with file:', resumeFile.name);
                response = await API.analyzeJDMatch(resumeFile, jdText);
                console.log('JD Match Response:', response);
            } catch (error) {
                console.error('Error analyzing match:', error);
                this.showError('Failed to analyze match. Please check your backend server is running on port 8001.');
                return;
            }
        } else {
            // Use stored resume
            const select = document.getElementById('jd-stored-resume-select');
            const resumeId = select?.value;
            
            if (!resumeId) {
                showNotification('Please select a resume', 'warning');
                return;
            }
            
            // Show loading
            const inputSection = document.getElementById('jd-input-section');
            inputSection.innerHTML = '<div class="text-center py-12"><div class="spinner mx-auto"></div><p class="mt-4 text-gray-400">Analyzing stored resume... This may take 10-20 seconds.</p></div>';
            
            try {
                console.log('Analyzing JD match for stored resume:', resumeId);
                response = await API.analyzeJDMatchStored(resumeId, jdText);
                console.log('JD Match Response:', response);
            } catch (error) {
                console.error('Error analyzing match:', error);
                this.showError('Failed to analyze match. Please try again.');
                return;
            }
        }
        
        // Handle response
        if (response && response.success && response.data) {
            this.currentMatch = response.data;
            this.showResults();
        } else {
            this.showError(response?.message || 'Failed to analyze match. Please check backend logs for details.');
        }
    }

    showError(message) {
        const inputSection = document.getElementById('jd-input-section');
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
                        <li>• Job description is too short (minimum 50 characters)</li>
                        <li>• MongoDB not running on localhost:27017</li>
                    </ul>
                </div>
                <button onclick="JDMatcher.instance.reset()" 
                        class="px-6 py-3 bg-accent-cyan text-white rounded-lg hover:bg-accent-cyan/90 transition">
                    Try Again
                </button>
            </div>
        `;
        showNotification(message, 'error');
    }

    showResults() {
        const inputSection = document.getElementById('jd-input-section');
        const resultsSection = document.getElementById('jd-results-section');
        const resultsContent = document.getElementById('jd-results-content');
        
        if (!inputSection || !resultsSection || !resultsContent) {
            console.error('Required elements not found!');
            return;
        }
        
        inputSection.classList.add('hidden');
        resultsSection.classList.remove('hidden');
        
        const match = this.currentMatch;
        
        console.log('JD Match result:', match);
        
        // Ensure data structure is correct
        if (!match || !match.matchScore || !match.analysis) {
            console.error('Invalid match data:', match);
            this.showError('Invalid response data received');
            return;
        }
        
        resultsContent.innerHTML = `
            <!-- Overall Match Score -->
            <div class="match-score">
                <div class="score-circle mx-auto">
                    <span>${match.matchScore}%</span>
                </div>
                <h3 class="text-2xl font-bold mt-4">Match Score</h3>
                <p class="text-gray-400">Your profile matches this job description</p>
            </div>
            
            <!-- Detailed Analysis -->
            <div class="grid md:grid-cols-2 gap-6 mb-6">
                <div class="comparison-section">
                    <h3 class="text-xl font-bold mb-4 text-accent-cyan">Technical Skills</h3>
                    <div class="ats-metric">
                        <div>
                            <p class="font-semibold">Match Level</p>
                            <div class="progress-bar">
                                <div class="progress-fill" style="width: ${match.analysis.technicalSkills}%"></div>
                            </div>
                        </div>
                        <span class="text-accent-cyan font-bold">${match.analysis.technicalSkills}%</span>
                    </div>
                </div>
                
                <div class="comparison-section">
                    <h3 class="text-xl font-bold mb-4 text-accent-cyan">Experience</h3>
                    <div class="ats-metric">
                        <div>
                            <p class="font-semibold">Match Level</p>
                            <div class="progress-bar">
                                <div class="progress-fill" style="width: ${match.analysis.experience}%"></div>
                            </div>
                        </div>
                        <span class="text-accent-cyan font-bold">${match.analysis.experience}%</span>
                    </div>
                </div>
                
                <div class="comparison-section">
                    <h3 class="text-xl font-bold mb-4 text-accent-cyan">Education</h3>
                    <div class="ats-metric">
                        <div>
                            <p class="font-semibold">Match Level</p>
                            <div class="progress-bar">
                                <div class="progress-fill" style="width: ${match.analysis.education}%"></div>
                            </div>
                        </div>
                        <span class="text-accent-cyan font-bold">${match.analysis.education}%</span>
                    </div>
                </div>
                
                <div class="comparison-section">
                    <h3 class="text-xl font-bold mb-4 text-accent-cyan">Keywords</h3>
                    <div class="ats-metric">
                        <div>
                            <p class="font-semibold">Match Level</p>
                            <div class="progress-bar">
                                <div class="progress-fill" style="width: ${match.analysis.keywords}%"></div>
                            </div>
                        </div>
                        <span class="text-accent-cyan font-bold">${match.analysis.keywords}%</span>
                    </div>
                </div>
            </div>
            
            <!-- Recommendations -->
            <div class="comparison-section">
                <h3 class="text-xl font-bold mb-4 text-accent-cyan">Recommendations</h3>
                <ul class="space-y-3">
                    ${(match.recommendations && match.recommendations.length > 0) ? match.recommendations.map(rec => `
                        <li class="flex items-start gap-3 p-3 bg-primary-dark rounded-lg">
                            <span class="text-accent-cyan text-xl">💡</span>
                            <span class="text-gray-300">${rec}</span>
                        </li>
                    `).join('') : '<li class="text-gray-400">No recommendations available</li>'}
                </ul>
            </div>
            
            <!-- Actions -->
            <div class="flex gap-4 mt-6">
                <button onclick="JDMatcher.instance.reset()" 
                        class="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition">
                    New Analysis
                </button>
                <button onclick="document.getElementById('jd-matcher-modal').remove()" 
                        class="px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition">
                    Close
                </button>
            </div>
        `;
        
        // Don't close the modal - let user close it manually
        showNotification('Analysis complete!', 'success');
        
        // Log activity to calendar
        if (typeof window.logCalendarActivity === 'function') {
            try {
                window.logCalendarActivity('jd_match', 'Job Description Match', {
                    description: `Job match analysis completed with score: ${match.matchScore}%`,
                    score: match.matchScore,
                    reference_id: match.matchId,
                    status: 'completed'
                });
            } catch (error) {
                console.error('Error logging to calendar:', error);
            }
        }
    }

    reset() {
        const inputSection = document.getElementById('jd-input-section');
        const resultsSection = document.getElementById('jd-results-section');
        
        resultsSection.classList.add('hidden');
        inputSection.classList.remove('hidden');
        
        // Recreate input section with resume upload
        inputSection.innerHTML = `
            <div class="space-y-6">
                <!-- Resume Selection Tabs -->
                <div>
                    <label class="block text-sm font-medium mb-2">Resume</label>
                    <div class="flex gap-4 border-b border-accent-cyan/20 mb-4">
                        <button id="jd-upload-new-tab" class="px-4 py-2 border-b-2 border-accent-cyan text-accent-cyan font-semibold" onclick="JDMatcher.instance.switchTab('upload')">
                            Upload New
                        </button>
                        <button id="jd-use-stored-tab" class="px-4 py-2 border-b-2 border-transparent text-gray-400 hover:text-accent-cyan" onclick="JDMatcher.instance.switchTab('stored')">
                            Use Stored Resume
                        </button>
                    </div>
                    
                    <!-- Upload New Tab -->
                    <div id="jd-upload-new-content">
                        <input type="file" 
                               id="resume-upload-jd"
                               accept=".pdf,.doc,.docx"
                               class="w-full px-4 py-3 bg-primary-dark border border-accent-cyan/30 rounded-lg focus:outline-none focus:border-accent-cyan text-white file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-accent-cyan/20 file:text-accent-cyan hover:file:bg-accent-cyan/30">
                    </div>
                    
                    <!-- Stored Resume Tab -->
                    <div id="jd-use-stored-content" class="hidden">
                        <select id="jd-stored-resume-select" 
                                class="w-full px-4 py-3 bg-primary-dark border border-accent-cyan/30 rounded-lg focus:outline-none focus:border-accent-cyan text-white">
                            <option value="">Loading resumes...</option>
                        </select>
                    </div>
                </div>
                
                <div>
                    <label class="block text-sm font-medium mb-2">Job Description</label>
                    <textarea id="jd-text" 
                              rows="8"
                              class="w-full px-4 py-3 bg-primary-dark border border-accent-cyan/30 rounded-lg focus:outline-none focus:border-accent-cyan text-white"
                              placeholder="Paste the job description here..."></textarea>
                </div>
                
                <div class="flex gap-4">
                    <button onclick="JDMatcher.instance.analyzeMatch()" 
                            class="flex-1 px-6 py-3 bg-accent-cyan text-white rounded-lg hover:bg-accent-cyan/90 transition">
                        Analyze Match
                    </button>
                    <button onclick="this.closest('.modal-backdrop').remove()" 
                            class="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition">
                        Cancel
                    </button>
                </div>
            </div>
        `;
        
        this.currentMatch = null;
        this.loadStoredResumes();
    }

    downloadReport() {
        if (!this.currentMatch) {
            showNotification('No report available', 'error');
            return;
        }
        
        // Check if we have matchId from backend
        if (this.currentMatch.matchId) {
            // Download DOCX report from backend
            const downloadUrl = `${API.baseURL}/jd-matcher/download/${this.currentMatch.matchId}`;
            
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
                    a.download = `jd_match_report_${Date.now()}.docx`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    showNotification('Report downloaded successfully!', 'success');
                })
                .catch(error => {
                    console.error('Error downloading report:', error);
                    showNotification('Failed to download report', 'error');
                });
        } else {
            showNotification('Report not available. Please try analyzing again.', 'error');
        }
    }
}

// Create singleton instance
JDMatcher.instance = new JDMatcher();

// Export for use in dashboard
if (typeof window !== 'undefined') {
    window.JDMatcher = JDMatcher;
}
