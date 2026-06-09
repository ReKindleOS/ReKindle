/**
 * REKINDLE REPORTS - Shared reporting module for social apps
 * 
 * Provides a System 7-styled report modal that can be triggered from
 * any social app (KindleChat, Neighbourhood, Topics).
 * 
 * Usage:
 *   rekindleOpenReportModal({
 *     contentType: 'kindlechat|topic|topic_comment|neighbourhood_post|neighbourhood_comment',
 *     contentId: 'message-key-or-doc-id',
 *     contentPath: 'kindlechat/messages/xxx',
 *     reportedUserId: 'uid-of-content-author',
 *     contentSnapshot: 'text/content-to-show-in-report'
 *   });
 */

(function () {
    'use strict';

    var REPORT_REASONS = [
        { value: 'spam', label: 'Spam' },
        { value: 'harassment', label: 'Harassment' },
        { value: 'inappropriate', label: 'Inappropriate content' },
        { value: 'hate_speech', label: 'Hate speech' },
        { value: 'self_harm', label: 'Self-harm' },
        { value: 'violence', label: 'Violence' },
        { value: 'other', label: 'Other' }
    ];

    var MAX_COMMENT_LENGTH = 200;

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function closeReportModal() {
        var overlay = document.getElementById('rekindle-report-overlay');
        if (overlay) overlay.parentNode.removeChild(overlay);
    }

    function showReportSuccess() {
        var body = document.querySelector('#rekindle-report-overlay .report-body');
        if (!body) return;
        body.innerHTML = '';
        
        var msg = document.createElement('div');
        msg.style.cssText = 'text-align:center;padding:20px;font-size:1rem;';
        msg.innerHTML = '<strong>Thank you.</strong><br><br>Your report has been submitted and will be reviewed by our moderation team.';
        body.appendChild(msg);

        var okBtn = document.createElement('button');
        okBtn.textContent = 'OK';
        okBtn.style.cssText = 'font-family:inherit;font-size:0.85rem;border:2px solid black;background:black;color:white;padding:5px 20px;cursor:pointer;box-shadow:2px 2px 0 black;margin-top:15px;';
        okBtn.onclick = closeReportModal;
        
        var btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;justify-content:center;';
        btnRow.appendChild(okBtn);
        body.appendChild(btnRow);
    }

    function getWorkerUrl() {
        if (typeof MODERATION_WORKER_URL !== 'undefined' && MODERATION_WORKER_URL) {
            return MODERATION_WORKER_URL;
        }
        return 'https://rekindle-moderate.timjarnott.workers.dev';
    }

    function getAuthToken() {
        return new Promise(function (resolve, reject) {
            var tokenSource = null;
            if (typeof socialAuth !== 'undefined' && socialAuth.currentUser) {
                tokenSource = socialAuth.currentUser;
            } else if (typeof currentUser !== 'undefined' && currentUser) {
                tokenSource = currentUser;
            } else if (typeof auth !== 'undefined' && auth.currentUser) {
                tokenSource = auth.currentUser;
            }

            if (!tokenSource) {
                reject(new Error('You must be signed in to submit a report.'));
                return;
            }

            tokenSource.getIdToken(true).then(resolve)['catch'](reject);
        });
    }

    function submitReport(data) {
        var submitBtn = document.getElementById('report-submit-btn');
        var errorEl = document.getElementById('report-error');
        
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Submitting...';
        }
        if (errorEl) errorEl.textContent = '';

        var reasonSelect = document.getElementById('report-reason-select');
        var commentInput = document.getElementById('report-comment-input');
        
        var reason = reasonSelect ? reasonSelect.value : '';
        var comment = commentInput ? commentInput.value.trim() : '';

        if (!reason) {
            if (errorEl) errorEl.textContent = 'Please select a reason for your report.';
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Submit Report';
            }
            return;
        }

        getAuthToken().then(function (token) {
            var reportData = {
                type: 'report',
                contentType: data.contentType,
                contentId: data.contentId,
                contentPath: data.contentPath,
                reportedUserId: data.reportedUserId,
                reason: reason,
                comment: comment,
                contentSnapshot: data.contentSnapshot
            };

            return fetch(getWorkerUrl(), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + token
                },
                body: JSON.stringify(reportData)
            });
        }).then(function (resp) {
            return resp.json();
        }).then(function (result) {
            if (result.error) {
                throw new Error(result.error);
            }
            showReportSuccess();
        })['catch'](function (err) {
            console.error('Report submission error:', err);
            if (errorEl) errorEl.textContent = err.message || 'Failed to submit report. Please try again.';
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Submit Report';
            }
        });
    }

    window.rekindleOpenReportModal = function (data) {
        if (!data || !data.contentType || !data.contentId) {
            console.error('rekindleOpenReportModal: Missing required fields');
            return;
        }

        var existing = document.getElementById('rekindle-report-overlay');
        if (existing) existing.parentNode.removeChild(existing);

        var overlay = document.createElement('div');
        overlay.id = 'rekindle-report-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;font-family:Geneva,Verdana,sans-serif;';

        var box = document.createElement('div');
        box.style.cssText = 'background:white;border:2px solid black;box-shadow:4px 4px 0 black;width:90%;max-width:400px;max-height:90vh;overflow-y:auto;';

        var titleBar = document.createElement('div');
        titleBar.style.cssText = 'border-bottom:2px solid black;padding:10px;font-weight:bold;text-align:center;font-size:1rem;position:relative;';
        titleBar.textContent = 'Report Content';

        var closeBtn = document.createElement('button');
        closeBtn.textContent = 'X';
        closeBtn.style.cssText = 'position:absolute;right:8px;top:50%;transform:translateY(-50%);width:22px;height:22px;border:2px solid black;background:white;cursor:pointer;font-family:inherit;font-size:0.75rem;line-height:1;display:flex;align-items:center;justify-content:center;box-shadow:2px 2px 0 black;';
        closeBtn.onclick = closeReportModal;
        titleBar.appendChild(closeBtn);

        var body = document.createElement('div');
        body.className = 'report-body';
        body.style.cssText = 'padding:15px;';

        var reasonLabel = document.createElement('label');
        reasonLabel.textContent = 'Reason *';
        reasonLabel.style.cssText = 'display:block;font-weight:bold;font-size:0.85rem;margin-bottom:4px;margin-top:10px;';
        body.appendChild(reasonLabel);

        var select = document.createElement('select');
        select.id = 'report-reason-select';
        select.style.cssText = 'width:100%;border:2px solid black;border-radius:0;padding:6px;font-family:inherit;font-size:0.85rem;background:white;';
        var defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.textContent = 'Select a reason...';
        select.appendChild(defaultOpt);
        REPORT_REASONS.forEach(function (opt) {
            var option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.label;
            select.appendChild(option);
        });
        body.appendChild(select);

        var commentLabel = document.createElement('label');
        commentLabel.textContent = 'Additional Comment (optional)';
        commentLabel.style.cssText = 'display:block;font-weight:bold;font-size:0.85rem;margin-bottom:4px;margin-top:10px;';
        body.appendChild(commentLabel);

        var textarea = document.createElement('textarea');
        textarea.id = 'report-comment-input';
        textarea.placeholder = 'Provide any additional details...';
        textarea.maxLength = MAX_COMMENT_LENGTH;
        textarea.style.cssText = 'width:100%;min-height:80px;border:2px solid black;border-radius:0;padding:6px;font-family:inherit;font-size:0.85rem;resize:vertical;box-sizing:border-box;margin-top:4px;';
        
        var counter = document.createElement('div');
        counter.id = 'report-char-counter';
        counter.textContent = '0 / ' + MAX_COMMENT_LENGTH;
        counter.style.cssText = 'font-size:0.75rem;color:#666;text-align:right;margin-top:2px;';
        
        textarea.oninput = function () {
            counter.textContent = textarea.value.length + ' / ' + MAX_COMMENT_LENGTH;
        };
        
        body.appendChild(textarea);
        body.appendChild(counter);

        if (data.contentSnapshot) {
            var preview = document.createElement('div');
            preview.style.cssText = 'background:#f5f5f5;border:1px solid #ccc;padding:8px;margin-top:10px;font-size:0.8rem;max-height:100px;overflow-y:auto;word-break:break-word;';
            preview.innerHTML = '<strong>Content preview:</strong><br>' + escapeHtml(data.contentSnapshot.substring(0, 300)) + (data.contentSnapshot.length > 300 ? '...' : '');
            body.appendChild(preview);
        }

        var errorEl = document.createElement('div');
        errorEl.id = 'report-error';
        errorEl.style.cssText = 'color:red;font-size:0.8rem;margin-top:8px;min-height:16px;';
        body.appendChild(errorEl);

        var btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;justify-content:flex-end;margin-top:12px;';

        var cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText = 'font-family:inherit;font-size:0.85rem;border:2px solid black;background:white;padding:5px 12px;cursor:pointer;box-shadow:2px 2px 0 black;margin-right:8px;';
        cancelBtn.onclick = closeReportModal;

        var submitBtn = document.createElement('button');
        submitBtn.id = 'report-submit-btn';
        submitBtn.textContent = 'Submit Report';
        submitBtn.style.cssText = 'font-family:inherit;font-size:0.85rem;border:2px solid black;background:black;color:white;padding:5px 12px;cursor:pointer;box-shadow:2px 2px 0 black;';
        submitBtn.onclick = function () { submitReport(data); };

        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(submitBtn);
        body.appendChild(btnRow);

        box.appendChild(titleBar);
        box.appendChild(body);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
    };

    window.rekindleCloseReportModal = closeReportModal;
})();
