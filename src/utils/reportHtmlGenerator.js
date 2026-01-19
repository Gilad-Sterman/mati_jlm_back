/**
 * Utility for generating HTML from report content
 * This creates a complete HTML document with inline CSS for client reports
 */

/**
 * Generate HTML for a client report
 * @param {Object} report - The report object from the database
 * @param {Object} session - The session object with client and adviser info
 * @param {Object} client - The client object
 * @returns {String} Complete HTML document as a string
 */
function generateReportHtml(report, session, client) {
  try {
    // Parse report content if it's a string
    const content = typeof report.content === 'string' 
      ? JSON.parse(report.content) 
      : report.content;
    
    if (!content) {
      throw new Error('Report content is empty or invalid');
    }

    // Detect language from session transcription metadata
    const language = detectLanguage(session);
    const isHebrew = language === 'hebrew';
    
    // Get localized titles
    const titles = getLocalizedTitles(isHebrew);

    // Detect if this is the new report structure (has key_insights and action_items)
    const isNewStructure = content.key_insights && content.action_items;
    
    // Format date
    const sessionDate = new Date(session?.created_at).toLocaleDateString();
    
    // Generate HTML with inline CSS
    const html = `
      <!DOCTYPE html>
      <html lang="${isHebrew ? 'he' : 'en'}" dir="${isHebrew ? 'rtl' : 'ltr'}">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${client?.name || 'Client'} Report - ${sessionDate}</title>
        <style>
          body {
            font-family: ${isHebrew ? '"Segoe UI", Tahoma, Arial, sans-serif' : 'Arial, sans-serif'};
            line-height: 1.6;
            color: #333;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            text-align: ${isHebrew ? 'right' : 'left'};
            direction: ${isHebrew ? 'rtl' : 'ltr'};
          }
          .document-header {
            margin-bottom: 1.5rem;
            padding-bottom: 1rem;
            border-bottom: 2px solid #000000;
            display: flex;
            justify-content: space-between;
          }
          .header-left {
            width: 70%;
          }
          .header-right {
            width: 30%;
            text-align: ${isHebrew ? 'left' : 'right'};
          }
          .report-title {
            font-size: 1.8rem;
            font-weight: 700;
            color: #000000;
            margin-bottom: 0.5rem;
            line-height: 1.2;
          }
          .client-name {
            font-size: 1.3rem;
            font-weight: 600;
            color: #000000;
            margin-bottom: 1rem;
            line-height: 1.3;
          }
          .meta-item {
            display: block;
            margin-bottom: 0.4rem;
            line-height: 1.4;
          }
          .meta-label {
            font-weight: 600;
            color: #000000;
            display: inline;
          }
          .meta-value {
            color: #000000;
            font-weight: 400;
            display: inline;
            margin-left: 0.5rem;
          }
          .content-section {
            margin-bottom: 2rem;
          }
          h5 {
            font-size: 1.5rem;
            font-weight: 600;
            color: #000000;
            margin-bottom: 1rem;
            padding-bottom: 0.5rem;
            border-bottom: 1px solid #000000;
            page-break-after: avoid;
          }
          p {
            margin-bottom: 1rem;
            line-height: 1.6;
          }
          .insight-item {
            margin-bottom: 1.5rem;
          }
          .insight-category {
            margin-bottom: 0.5rem;
            font-weight: bold;
          }
          .insight-content {
            margin-bottom: 0.5rem;
          }
          .supporting-quotes {
            margin-${isHebrew ? 'right' : 'left'}: 1rem;
            margin-top: 0.5rem;
          }
          .supporting-quotes ul {
            margin-top: 0.5rem;
            padding-${isHebrew ? 'right' : 'left'}: 1.5rem;
            padding-${isHebrew ? 'left' : 'right'}: 0;
          }
          .supporting-quotes li {
            margin-bottom: 0.25rem;
          }
          .action-item {
            margin-bottom: 1.5rem;
          }
          .action-task {
            margin-bottom: 0.5rem;
            font-weight: bold;
          }
          .action-details {
            padding-${isHebrew ? 'right' : 'left'}: 1rem;
            padding-${isHebrew ? 'left' : 'right'}: 0;
          }
          .action-owner, .action-deadline, .action-status {
            margin-bottom: 0.25rem;
          }
          .status-open { color: #f59e0b; }
          .status-in-progress { color: #3b82f6; }
          .status-completed { color: #10b981; }
          .mati-logo {
            height: 90px;
            width: auto;
            max-width: 100%;
          }
          @media print {
            body { 
              font-size: 12pt; 
            }
            .page-break {
              page-break-before: always;
            }
          }
        </style>
      </head>
      <body>
        <!-- Professional Header -->
        <div class="document-header">
          <div class="header-left">
            <h1 class="report-title">${titles.clientReport}</h1>
            ${client?.name ? `<h2 class="client-name">${client.name}</h2>` : ''}
            <div class="report-meta">
              <div class="meta-item">
                <span class="meta-label">Date:</span>
                <span class="meta-value">${sessionDate}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">Adviser:</span>
                <span class="meta-value">${session?.adviser?.name || 'N/A'}</span>
              </div>
              ${session?.adviser?.email ? `
              <div class="meta-item">
                <span class="meta-label">Email:</span>
                <span class="meta-value">${session.adviser.email}</span>
              </div>
              ` : ''}
              ${session?.adviser?.phone ? `
              <div class="meta-item">
                <span class="meta-label">Phone:</span>
                <span class="meta-value">${session.adviser.phone}</span>
              </div>
              ` : ''}
            </div>
          </div>
          <div class="header-right">
            <!-- Logo would be embedded as base64 in production -->
            <img src="https://res.cloudinary.com/demo/image/upload/mati/logo-full.png" alt="MATI" class="mati-logo" />
          </div>
        </div>
        
        <div class="document-content">
          ${isNewStructure ? generateNewStructureContent(content, titles) : generateLegacyStructureContent(content, titles)}
        </div>
      </body>
      </html>
    `;
    
    return html;
  } catch (error) {
    console.error('Error generating report HTML:', error);
    return generateErrorHtml(report, session, client, error);
  }
}

/**
 * Generate HTML content for the new report structure
 */
function generateNewStructureContent(content, titles) {
  let html = '';
  
  // General Summary Section
  if (content.general_summary) {
    html += `
      <div class="content-section">
        <h5>${titles.generalSummary}</h5>
        <div class="content-preview">
          <p>${content.general_summary}</p>
        </div>
      </div>
    `;
  }
  
  // Key Insights Section
  if (content.key_insights && Array.isArray(content.key_insights) && content.key_insights.length > 0) {
    html += `
      <div class="content-section">
        <h5>${titles.keyInsights}</h5>
        <div class="content-preview">
    `;
    
    content.key_insights.forEach(insight => {
      html += `
        <div class="insight-item">
          <div class="insight-category">
            <strong>${translateCategory(insight.category)}</strong>
          </div>
          <div class="insight-content">
            <p>${insight.content}</p>
          </div>
      `;
      
      // if (insight.supporting_quotes && insight.supporting_quotes.filter(quote => quote && quote.trim()).length > 0) {
      //   html += `
      //     <div class="supporting-quotes">
      //       <strong>${titles.supportingQuotes}:</strong>
      //       <ul>
      //   `;
        
      //   insight.supporting_quotes.filter(quote => quote && quote.trim()).forEach(quote => {
      //     html += `<li>"${quote}"</li>`;
      //   });
        
      //   html += `
      //       </ul>
      //     </div>
      //   `;
      // }
      
      html += `</div>`;
    });
    
    html += `
        </div>
      </div>
    `;
  }
  
  // Action Items Section
  if (content.action_items && Array.isArray(content.action_items) && content.action_items.length > 0) {
    html += `
      <div class="content-section">
        <h5>${titles.actionItems}</h5>
        <div class="content-preview">
    `;
    
    content.action_items.forEach(item => {
      html += `
        <div class="action-item">
          <div class="action-task">
            <strong>${item.task}</strong>
          </div>
        </div>
      `;
    });
    
    html += `
        </div>
      </div>
    `;
  }
  
  // Target Summary Section
  if (content.target_summary) {
    html += `
      <div class="content-section">
        <h5>${titles.targetSummary}</h5>
        <div class="content-preview">
          <p>${content.target_summary}</p>
        </div>
      </div>
    `;
  }
  
  return html;
}

/**
 * Generate HTML content for the legacy report structure
 */
function generateLegacyStructureContent(content, titles) {
  let html = '';
  
  // Executive Summary
  if (content.executive_summary) {
    html += `
      <div class="content-section">
        <h5>${titles.executiveSummary}</h5>
        <div class="content-preview">
          <p>${content.executive_summary}</p>
        </div>
      </div>
    `;
  }
  
  // Entrepreneur Needs
  if (content.entrepreneur_needs) {
    html += `
      <div class="content-section">
        <h5>${titles.entrepreneurNeeds}</h5>
        <div class="content-preview">
    `;
    
    if (Array.isArray(content.entrepreneur_needs)) {
      content.entrepreneur_needs.forEach(need => {
        html += `
          <div class="need-item">
            <strong>${need.need_conceptualization}</strong>
            <p>${need.need_explanation}</p>
        `;
        
        if (need.supporting_quotes && need.supporting_quotes.length > 0) {
          html += `
            <div class="supporting-quotes">
              <strong>Supporting Quotes:</strong>
              <ul>
          `;
          
          need.supporting_quotes.forEach(quote => {
            html += `<li>"${quote}"</li>`;
          });
          
          html += `
              </ul>
            </div>
          `;
        }
        
        html += `</div>`;
      });
    } else {
      if (content.entrepreneur_needs.need_conceptualization) {
        html += `
          <div class="need-item">
            <strong>${content.entrepreneur_needs.need_conceptualization}</strong>
            <p>${content.entrepreneur_needs.need_explanation || ''}</p>
          </div>
        `;
      }
      
      if (content.entrepreneur_needs.supporting_quotes && content.entrepreneur_needs.supporting_quotes.length > 0) {
        html += `
          <div class="supporting-quotes">
            <strong>Supporting Quotes:</strong>
            <ul>
        `;
        
        content.entrepreneur_needs.supporting_quotes.forEach(quote => {
          html += `<li>"${quote}"</li>`;
        });
        
        html += `
            </ul>
          </div>
        `;
      }
    }
    
    html += `
        </div>
      </div>
    `;
  }
  
  // Advisor Solutions
  if (content.advisor_solutions) {
    html += `
      <div class="content-section">
        <h5>${titles.advisorSolutions}</h5>
        <div class="content-preview">
    `;
    
    if (Array.isArray(content.advisor_solutions)) {
      content.advisor_solutions.forEach(solution => {
        html += `
          <div class="solution-item">
            <strong>${solution.solution_conceptualization}</strong>
            <p>${solution.solution_explanation}</p>
        `;
        
        if (solution.supporting_quotes && solution.supporting_quotes.length > 0) {
          html += `
            <div class="supporting-quotes">
              <strong>Supporting Quotes:</strong>
              <ul>
          `;
          
          solution.supporting_quotes.forEach(quote => {
            html += `<li>"${quote}"</li>`;
          });
          
          html += `
              </ul>
            </div>
          `;
        }
        
        html += `</div>`;
      });
    } else {
      if (content.advisor_solutions.solution_conceptualization) {
        html += `
          <div class="solution-item">
            <strong>${content.advisor_solutions.solution_conceptualization}</strong>
            <p>${content.advisor_solutions.solution_explanation || ''}</p>
          </div>
        `;
      }
      
      if (content.advisor_solutions.supporting_quotes && content.advisor_solutions.supporting_quotes.length > 0) {
        html += `
          <div class="supporting-quotes">
            <strong>Supporting Quotes:</strong>
            <ul>
        `;
        
        content.advisor_solutions.supporting_quotes.forEach(quote => {
          html += `<li>"${quote}"</li>`;
        });
        
        html += `
            </ul>
          </div>
        `;
      }
    }
    
    html += `
        </div>
      </div>
    `;
  }
  
  // Agreed Actions
  if (content.agreed_actions) {
    const hasImmediateActions = content.agreed_actions.immediate_actions && content.agreed_actions.immediate_actions.length > 0;
    const hasRecommendation = content.agreed_actions.concrete_recommendation && typeof content.agreed_actions.concrete_recommendation === 'string' && content.agreed_actions.concrete_recommendation.trim();
    
    if (hasImmediateActions || hasRecommendation) {
      html += `
        <div class="content-section">
          <h5>${titles.agreedActions}</h5>
          <div class="content-preview">
      `;
      
      if (hasImmediateActions) {
        html += `
          <div class="actions-item">
            <strong>Immediate Actions</strong>
            <ul class="actions-list">
        `;
        
        content.agreed_actions.immediate_actions.forEach(action => {
          html += `<li>${action}</li>`;
        });
        
        html += `
            </ul>
          </div>
        `;
      }
      
      if (hasRecommendation) {
        html += `
          <div class="actions-item">
            <strong>Concrete Recommendation</strong>
            <p>${content.agreed_actions.concrete_recommendation}</p>
          </div>
        `;
      }
      
      html += `
          </div>
        </div>
      `;
    }
  }
  
  return html;
}

/**
 * Generate error HTML when report generation fails
 */
function generateErrorHtml(report, session, client, error) {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Error Generating Report</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 800px;
          margin: 0 auto;
          padding: 20px;
        }
        .error-container {
          background-color: #fff5f5;
          border-left: 4px solid #f56565;
          padding: 1rem;
          margin-bottom: 1rem;
        }
        .error-title {
          color: #c53030;
          font-weight: bold;
          margin-bottom: 0.5rem;
        }
        .error-message {
          color: #742a2a;
        }
      </style>
    </head>
    <body>
      <h1>Error Generating Report</h1>
      <div class="error-container">
        <div class="error-title">An error occurred while generating the report:</div>
        <div class="error-message">${error.message}</div>
      </div>
      <p>Please contact support with the following information:</p>
      <ul>
        <li>Report ID: ${report?.id || 'Unknown'}</li>
        <li>Session ID: ${session?.id || 'Unknown'}</li>
        <li>Client: ${client?.name || 'Unknown'}</li>
        <li>Time: ${new Date().toISOString()}</li>
      </ul>
    </body>
    </html>
  `;
}

/**
 * Helper function to translate category names
 */
function translateCategory(category) {
  const categoryMap = {
    'what we learned about the clients business': 'What We Learned About the Client\'s Business',
    'decisions made': 'Decisions Made',
    'opportunities/risks or concerns that came up': 'Opportunities/Risks or Concerns That Came Up'
  };
  
  return categoryMap[category] || category;
}

/**
 * Helper function to translate owner values
 */
function translateOwner(owner) {
  const ownerMap = {
    'client': 'Client',
    'adviser': 'Adviser',
    'advisor': 'Adviser' // Handle both spellings
  };
  
  return ownerMap[owner?.toLowerCase()] || owner;
}

/**
 * Helper function to translate status values
 */
function translateStatus(status) {
  const statusMap = {
    'open': 'Open',
    'in progress': 'In Progress',
    'completed': 'Completed'
  };
  
  return statusMap[status?.toLowerCase()] || status;
}

/**
 * Helper function to get status CSS class
 */
function getStatusClass(status) {
  switch (status?.toLowerCase()) {
    case 'completed':
      return 'status-completed';
    case 'in progress':
      return 'status-in-progress';
    case 'open':
      return 'status-open';
    default:
      return '';
  }
}

/**
 * Detect language from session transcription metadata
 */
function detectLanguage(session) {
  try {
    if (session?.transcription_metadata) {
      const metadata = typeof session.transcription_metadata === 'string' 
        ? JSON.parse(session.transcription_metadata) 
        : session.transcription_metadata;
      
      return metadata.language || 'english';
    }
  } catch (error) {
    console.warn('Failed to parse transcription_metadata:', error);
  }
  
  // Default to English if no metadata or parsing fails
  return 'english';
}

/**
 * Get localized titles based on language
 */
function getLocalizedTitles(isHebrew) {
  if (isHebrew) {
    return {
      // Main titles
      clientReport: 'דוח לקוח',
      generalSummary: 'סיכום כללי',
      keyInsights: 'תובנות מרכזיות',
      actionItems: 'פעולות לביצוע',
      targetSummary: 'סיכום יעדים',
      
      // Legacy structure titles
      executiveSummary: 'סיכום מנהלים',
      entrepreneurNeeds: 'צרכי היזם',
      advisorSolutions: 'פתרונות היועץ',
      agreedActions: 'פעולות מוסכמות',
      
      // Field labels
      supportingQuotes: 'ציטוטים תומכים',
      owner: 'אחראי',
      deadline: 'מועד יעד',
      status: 'סטטוס',
      
      // Meta labels
      date: 'תאריך',
      adviser: 'יועץ',
      email: 'אימייל',
      phone: 'טלפון'
    };
  } else {
    return {
      // Main titles
      clientReport: 'Client Report',
      generalSummary: 'General Summary',
      keyInsights: 'Key Insights',
      actionItems: 'Action Items',
      targetSummary: 'Target Summary',
      
      // Legacy structure titles
      executiveSummary: 'Executive Summary',
      entrepreneurNeeds: 'Entrepreneur Needs',
      advisorSolutions: 'Advisor Solutions',
      agreedActions: 'Agreed Actions',
      
      // Field labels
      supportingQuotes: 'Supporting Quotes',
      owner: 'Owner',
      deadline: 'Deadline',
      status: 'Status',
      
      // Meta labels
      date: 'Date',
      adviser: 'Adviser',
      email: 'Email',
      phone: 'Phone'
    };
  }
}

/**
 * Generate HTML for just the action items section
 * @param {Object} report - The report object from the database
 * @param {Object} session - The session object with client and adviser info
 * @param {Object} client - The client object
 * @returns {String} HTML content for action items only
 */
function generateActionItemsHtml(report, session, client) {
  try {
    // Parse report content if it's a string
    const content = typeof report.content === 'string' 
      ? JSON.parse(report.content) 
      : report.content;
    
    if (!content) {
      return '<p>No action items available</p>';
    }

    // Detect language from session transcription metadata
    const language = detectLanguage(session);
    const isHebrew = language === 'hebrew';
    
    // Get localized titles
    const titles = getLocalizedTitles(isHebrew);

    // Check for new structure (action_items array)
    if (content.action_items && Array.isArray(content.action_items) && content.action_items.length > 0) {
      let html = `
        <div style="font-family: ${isHebrew ? '"Segoe UI", Tahoma, Arial, sans-serif' : 'Arial, sans-serif'}; direction: ${isHebrew ? 'rtl' : 'ltr'}; text-align: ${isHebrew ? 'right' : 'left'};">
          <h3 style="color: #000; margin-bottom: 1rem; font-size: 1.2rem;">${titles.actionItems}</h3>
          <div style="margin-bottom: 1rem;">
      `;
      
      content.action_items.forEach((item, index) => {
        html += `
          <div style="margin-bottom: 1rem; padding: 0.75rem; border: 1px solid #ddd; border-radius: 4px; background-color: #f9f9f9;">
            <div style="font-weight: bold; margin-bottom: 0.5rem; color: #000;">
              ${index + 1}. ${item.task}
            </div>
        `;
        
        // Add owner, deadline, status if available
        if (item.owner || item.deadline || item.status) {
          html += `<div style="font-size: 0.9rem; color: #666; margin-top: 0.5rem;">`;
          
          if (item.owner) {
            html += `<span style="margin-right: 1rem;"><strong>${isHebrew ? 'אחראי' : 'Owner'}:</strong> ${translateOwner(item.owner, isHebrew)}</span>`;
          }
          
          if (item.deadline) {
            html += `<span style="margin-right: 1rem;"><strong>${isHebrew ? 'מועד יעד' : 'Deadline'}:</strong> ${item.deadline}</span>`;
          }
          
          if (item.status) {
            html += `<span><strong>${isHebrew ? 'סטטוס' : 'Status'}:</strong> ${translateStatus(item.status, isHebrew)}</span>`;
          }
          
          html += `</div>`;
        }
        
        html += `</div>`;
      });
      
      html += `
          </div>
        </div>
      `;
      
      return html;
    }
    
    // Check for legacy structure (agreed_actions)
    if (content.agreed_actions) {
      const hasImmediateActions = content.agreed_actions.immediate_actions && content.agreed_actions.immediate_actions.length > 0;
      const hasRecommendation = content.agreed_actions.concrete_recommendation && typeof content.agreed_actions.concrete_recommendation === 'string' && content.agreed_actions.concrete_recommendation.trim();
      
      if (hasImmediateActions || hasRecommendation) {
        let html = `
          <div style="font-family: ${isHebrew ? '"Segoe UI", Tahoma, Arial, sans-serif' : 'Arial, sans-serif'}; direction: ${isHebrew ? 'rtl' : 'ltr'}; text-align: ${isHebrew ? 'right' : 'left'};">
            <h3 style="color: #000; margin-bottom: 1rem; font-size: 1.2rem;">${titles.agreedActions}</h3>
        `;
        
        if (hasImmediateActions) {
          html += `
            <div style="margin-bottom: 1rem;">
              <h4 style="color: #000; margin-bottom: 0.5rem;">Immediate Actions</h4>
              <ul style="margin: 0; padding-left: 1.5rem;">
          `;
          
          content.agreed_actions.immediate_actions.forEach(action => {
            html += `<li style="margin-bottom: 0.5rem;">${action}</li>`;
          });
          
          html += `</ul></div>`;
        }
        
        if (hasRecommendation) {
          html += `
            <div style="margin-bottom: 1rem;">
              <h4 style="color: #000; margin-bottom: 0.5rem;">Recommendation</h4>
              <p style="margin: 0;">${content.agreed_actions.concrete_recommendation}</p>
            </div>
          `;
        }
        
        html += `</div>`;
        return html;
      }
    }
    
    return '<p>No action items available</p>';
    
  } catch (error) {
    console.error('Error generating action items HTML:', error);
    return '<p>Error generating action items</p>';
  }
}

/**
 * Helper function to translate owner values
 */
function translateOwner(owner, isHebrew) {
  if (!owner) return '';
  
  const translations = {
    'client': isHebrew ? 'לקוח' : 'Client',
    'adviser': isHebrew ? 'יועץ' : 'Adviser',
    'advisor': isHebrew ? 'יועץ' : 'Advisor'
  };
  
  return translations[owner.toLowerCase()] || owner;
}

/**
 * Helper function to translate status values
 */
function translateStatus(status, isHebrew) {
  if (!status) return '';
  
  const translations = {
    'open': isHebrew ? 'פתוח' : 'Open',
    'in progress': isHebrew ? 'בתהליך' : 'In Progress',
    'completed': isHebrew ? 'הושלם' : 'Completed'
  };
  
  return translations[status.toLowerCase()] || status;
}

module.exports = {
  generateReportHtml,
  generateActionItemsHtml
};
