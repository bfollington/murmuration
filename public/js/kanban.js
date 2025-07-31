/**
 * Kanban Board Component for Issue Management
 * 
 * This module handles the kanban board UI for managing issues
 * across different workflow states: Open, In Progress, Completed
 */

class KanbanBoard {
    constructor(containerEl, websocket) {
        this.container = containerEl;
        this.ws = websocket;
        this.issues = new Map();
        this.draggedIssue = null;
        
        // Kanban columns configuration
        this.columns = [
            { id: 'open', title: 'Open', status: 'open' },
            { id: 'in-progress', title: 'In Progress', status: 'in-progress' },
            { id: 'completed', title: 'Completed', status: 'completed' }
        ];
        
        this.init();
    }
    
    init() {
        this.render();
        this.setupEventListeners();
        this.loadIssues();
    }
    
    render() {
        this.container.innerHTML = `
            <div class="kanban-board">
                <div class="kanban-header">
                    <h2>Issue Board</h2>
                    <div class="kanban-controls">
                        <button id="refresh-issues" class="btn btn-secondary">
                            <span class="icon">🔄</span> Refresh
                        </button>
                        <button id="add-issue" class="btn btn-primary">
                            <span class="icon">➕</span> Add Issue
                        </button>
                    </div>
                </div>
                <div class="kanban-columns">
                    ${this.columns.map(column => this.renderColumn(column)).join('')}
                </div>
            </div>
        `;
    }
    
    renderColumn(column) {
        return `
            <div class="kanban-column" data-status="${column.status}">
                <div class="column-header">
                    <h3>${column.title}</h3>
                    <span class="issue-count" id="count-${column.id}">0</span>
                </div>
                <div class="column-content" 
                     data-status="${column.status}"
                     ondrop="kanbanBoard.onDrop(event)" 
                     ondragover="kanbanBoard.onDragOver(event)">
                    <div class="drop-zone">
                        Drop issues here
                    </div>
                </div>
            </div>
        `;
    }
    
    renderIssueCard(issue) {
        const priorityClass = `priority-${issue.priority || 'medium'}`;
        const tags = issue.tags || [];
        
        return `
            <div class="issue-card" 
                 data-issue-id="${issue.id}" 
                 draggable="true"
                 ondragstart="kanbanBoard.onDragStart(event)">
                <div class="issue-header">
                    <span class="issue-id">${issue.id}</span>
                    <span class="issue-priority ${priorityClass}">${issue.priority || 'medium'}</span>
                </div>
                <div class="issue-title">${this.escapeHtml(issue.title)}</div>
                ${tags.length > 0 ? `
                    <div class="issue-tags">
                        ${tags.map(tag => `<span class="tag">${this.escapeHtml(tag)}</span>`).join('')}
                    </div>
                ` : ''}
                <div class="issue-actions">
                    <button class="btn-icon" onclick="kanbanBoard.viewIssue('${issue.id}')" title="View Details">
                        <span class="icon">👁️</span>
                    </button>
                    <button class="btn-icon" onclick="kanbanBoard.editIssue('${issue.id}')" title="Edit">
                        <span class="icon">✏️</span>
                    </button>
                </div>
            </div>
        `;
    }
    
    setupEventListeners() {
        // Refresh button
        document.getElementById('refresh-issues')?.addEventListener('click', () => {
            this.loadIssues();
        });
        
        // Add issue button
        document.getElementById('add-issue')?.addEventListener('click', () => {
            this.showAddIssueModal();
        });
    }
    
    // Drag and Drop Methods
    onDragStart(event) {
        const issueId = event.target.getAttribute('data-issue-id');
        this.draggedIssue = issueId;
        event.dataTransfer.setData('text/plain', issueId);
        event.target.classList.add('dragging');
        
        // Add visual feedback to drop zones
        document.querySelectorAll('.column-content').forEach(col => {
            col.classList.add('drag-active');
        });
    }
    
    onDragOver(event) {
        event.preventDefault();
        const dropZone = event.currentTarget;
        dropZone.classList.add('drag-over');
    }
    
    onDrop(event) {
        event.preventDefault();
        const dropZone = event.currentTarget;
        const newStatus = dropZone.getAttribute('data-status');
        const issueId = event.dataTransfer.getData('text/plain');
        
        // Clean up drag state
        this.cleanupDragState();
        
        if (issueId && newStatus) {
            this.moveIssue(issueId, newStatus);
        }
    }
    
    cleanupDragState() {
        document.querySelectorAll('.dragging').forEach(el => {
            el.classList.remove('dragging');
        });
        document.querySelectorAll('.drag-active, .drag-over').forEach(el => {
            el.classList.remove('drag-active', 'drag-over');
        });
        this.draggedIssue = null;
    }
    
    // Issue Management Methods
    async loadIssues() {
        try {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                // Request issues from server
                this.sendMessage('list_issues', {});
            } else {
                // Use mock data when not connected
                const mockIssues = [
                    {
                        id: 'ISSUE_14',
                        title: 'Create kanban board UI for issues',
                        status: 'in-progress',
                        priority: 'high',
                        tags: ['enhancement', 'web-ui', 'kanban']
                    },
                    {
                        id: 'ISSUE_15',
                        title: 'Connect web UI to file-based issue system',
                        status: 'open',
                        priority: 'high',
                        tags: ['enhancement', 'integration']
                    },
                    {
                        id: 'ISSUE_16',
                        title: 'Create unified HUD layout for web UI',
                        status: 'open',
                        priority: 'medium',
                        tags: ['enhancement', 'ui-design']
                    }
                ];
                
                this.updateIssues(mockIssues);
            }
        } catch (error) {
            console.error('Failed to load issues:', error);
            this.showError('Failed to load issues');
        }
    }
    
    updateIssues(issues) {
        // Clear existing issues
        this.issues.clear();
        
        // Update issues map
        issues.forEach(issue => {
            this.issues.set(issue.id, issue);
        });
        
        // Re-render all columns
        this.renderAllColumns();
        this.updateIssueCounts();
    }
    
    renderAllColumns() {
        this.columns.forEach(column => {
            const columnContent = document.querySelector(`[data-status="${column.status}"] .column-content`);
            if (columnContent) {
                const issuesInColumn = Array.from(this.issues.values())
                    .filter(issue => issue.status === column.status);
                
                if (issuesInColumn.length === 0) {
                    columnContent.innerHTML = '<div class="drop-zone">Drop issues here</div>';
                } else {
                    columnContent.innerHTML = issuesInColumn
                        .map(issue => this.renderIssueCard(issue))
                        .join('');
                }
            }
        });
    }
    
    updateIssueCounts() {
        this.columns.forEach(column => {
            const count = Array.from(this.issues.values())
                .filter(issue => issue.status === column.status).length;
            const countEl = document.getElementById(`count-${column.id}`);
            if (countEl) {
                countEl.textContent = count;
            }
        });
    }
    
    async moveIssue(issueId, newStatus) {
        const issue = this.issues.get(issueId);
        if (!issue) return;
        
        const oldStatus = issue.status;
        if (oldStatus === newStatus) return;
        
        try {
            // Update local state immediately for responsive UI
            issue.status = newStatus;
            this.renderAllColumns();
            this.updateIssueCounts();
            
            // Show feedback
            this.showSuccess(`Moved ${issueId} to ${newStatus}`);
            
            // TODO: Send update to server via WebSocket
            this.sendIssueUpdate(issueId, { status: newStatus });
            
        } catch (error) {
            // Revert on error
            issue.status = oldStatus;
            this.renderAllColumns();
            this.updateIssueCounts();
            console.error('Failed to move issue:', error);
            this.showError(`Failed to move ${issueId}`);
        }
    }
    
    sendMessage(type, data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type, data }));
        }
    }
    
    sendIssueUpdate(issueId, updates) {
        this.sendMessage('update_issue', { issueId, updates });
    }
    
    // Handle incoming WebSocket messages
    handleMessage(message) {
        switch (message.type) {
            case 'issues_list':
                if (message.data && message.data.issues) {
                    this.updateIssues(message.data.issues);
                }
                break;
            case 'issue_updated':
                if (message.data && message.data.issue) {
                    const issue = message.data.issue;
                    this.issues.set(issue.id, issue);
                    this.renderAllColumns();
                    this.updateIssueCounts();
                }
                break;
            case 'issue_created':
                if (message.data && message.data.issue) {
                    const issue = message.data.issue;
                    this.issues.set(issue.id, issue);
                    this.renderAllColumns();
                    this.updateIssueCounts();
                    this.showSuccess(`Issue ${issue.id} created`);
                }
                break;
        }
    }
    
    // UI Action Methods
    viewIssue(issueId) {
        const issue = this.issues.get(issueId);
        if (issue) {
            // TODO: Open issue details modal
            console.log('View issue:', issue);
            alert(`Issue: ${issue.title}\nStatus: ${issue.status}\nPriority: ${issue.priority}`);
        }
    }
    
    editIssue(issueId) {
        const issue = this.issues.get(issueId);
        if (issue) {
            // TODO: Open edit modal
            console.log('Edit issue:', issue);
            const newTitle = prompt('Edit title:', issue.title);
            if (newTitle && newTitle !== issue.title) {
                issue.title = newTitle;
                this.renderAllColumns();
                this.sendIssueUpdate(issueId, { title: newTitle });
            }
        }
    }
    
    showAddIssueModal() {
        // TODO: Implement proper modal
        const title = prompt('Issue title:');
        if (title) {
            const newIssue = {
                id: `ISSUE_${Date.now()}`,
                title,
                status: 'open',
                priority: 'medium',
                tags: []
            };
            
            this.issues.set(newIssue.id, newIssue);
            this.renderAllColumns();
            this.updateIssueCounts();
            this.sendIssueUpdate(newIssue.id, newIssue);
        }
    }
    
    // Utility Methods
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    showSuccess(message) {
        this.showNotification(message, 'success');
    }
    
    showError(message) {
        this.showNotification(message, 'error');
    }
    
    showNotification(message, type) {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        
        // Add to page
        document.body.appendChild(notification);
        
        // Auto-remove after 3 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 3000);
    }
}

// Export for use in main application
window.KanbanBoard = KanbanBoard;