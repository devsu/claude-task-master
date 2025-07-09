import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { readJSON, writeJSON, log, findProjectRoot, findTasksJsonPath } from '../utils.js';
import { generateTextService } from '../ai-services-unified.js';
import { getProjectName, getDebugFlag } from '../config-manager.js';
import generateClarifyingQuestions from './generate-clarifying-questions.js';
import readline from 'readline';
import { COMPLEXITY_REPORT_FILE } from '../../../src/constants/paths.js';

/**
 * Attempts to fix common JSON errors from AI responses.
 * @param {string} jsonString The potentially malformed JSON string.
 * @returns {string} A cleaner JSON string.
 */
function fixMalformedJson(jsonString) {
    let cleaned = jsonString.trim();

    // 1. Remove markdown fences and surrounding text that is not a JSON object.
    const jsonStartIndex = cleaned.indexOf('{');
    const jsonEndIndex = cleaned.lastIndexOf('}');
    if (jsonStartIndex !== -1 && jsonEndIndex !== -1) {
        cleaned = cleaned.substring(jsonStartIndex, jsonEndIndex + 1);
    } else {
        // If no object is found, return the original string for the parser to fail with a clear message.
        return jsonString;
    }

    // 2. Remove trailing commas from objects and arrays.
    // This is a common error from LLMs.
    cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');

    // 3. Attempt to fix unquoted or single-quoted keys.
    // This specifically targets the "Expected double-quoted property name" error.
    // It looks for a key (alphanumeric, _, -) that is not inside double quotes
    // and is followed by a colon.
    cleaned = cleaned.replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":'); // Unquoted keys
    cleaned = cleaned.replace(/([{,]\s*)'([^']+)'\s*:/g, '$1"$2":'); // Single-quoted keys

    return cleaned;
}

function waitForUserConfirmation(generatedFilePath) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve, reject) => {
        const question = () => {
            // Provide clear instructions to the user.
            console.log(chalk.cyan(`\nA clarifying questions document has been generated at: ${generatedFilePath}`));
            console.log(chalk.cyan('Please review the document, fill in the answers, and then return here.'));
            
            // Ask the question.
            rl.question(chalk.yellow.bold('Type "continue" to proceed with the analysis using the updated context, or "abort" to cancel: '), (answer) => {
                const cleanAnswer = answer.trim().toLowerCase();
                
                if (cleanAnswer === 'continue') {
                    rl.close();
                    resolve(); // Resolve the promise on 'continue'
                } else if (cleanAnswer === 'abort') {
                    rl.close();
                    // Reject the promise with a specific error message for clarity.
                    reject(new Error('User aborted analysis.'));
                } else {
                    // Handle invalid input and ask again.
                    console.log(chalk.red('\nInvalid input. Please type either "continue" or "abort".'));
                    question(); 
                }
            });
        };
        
        question(); // Initial call to start the prompt.
    });
}

async function analyzeTaskComplexity(options, context = {}) {
    const { session, mcpLog } = context;
    const { research, output, from, to, id, clarify, file } = options; // Added 'file' to destructuring

    const outputFormat = mcpLog ? 'json' : 'text';
    const reportLog = (message, level = 'info') => {
        if (mcpLog) {
            mcpLog[level](message);
        } else if (outputFormat === 'text') {
            log(level, message);
        }
    };

    const spinner = outputFormat === 'text' ? ora('Analyzing the complexity of your tasks with AI...').start() : null;
    const debug = getDebugFlag(session);

    try {
        const projectRoot = findProjectRoot();
        if (!projectRoot) {
            throw new Error('Could not determine project root. Please run `task-master init` first.');
        }

        // **FIXED**: Use the 'file' option if provided, otherwise find the default path.
        const tasksPath = file ? path.resolve(projectRoot, file) : findTasksJsonPath(projectRoot);
        reportLog(`Reading tasks from ${path.relative(projectRoot, tasksPath)}...`);

        const tasksData = readJSON(tasksPath, projectRoot);
        if (!tasksData || !tasksData.tasks) {
            throw new Error('No tasks found or tasks file is invalid.');
        }

        let tasksToAnalyze = tasksData.tasks;
        reportLog(`Found ${tasksToAnalyze.length} total tasks in the task file.`);

		const projectName = (tasksData.metadata && tasksData.metadata.projectName) || getProjectName(); // Use tasks metadata first

        // **UPDATED**: Determine the report path with new logic
        let reportPath;
        if (output !== COMPLEXITY_REPORT_FILE) {
            reportPath = path.resolve(projectRoot, output);
        } else {
            // Otherwise, construct the filename.
            let reportFileName = 'task-complexity-report.json'; // Default name
            if (projectName) {
                const sanitizedProjectName = projectName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
                reportFileName = `task-complexity-report-${sanitizedProjectName}.json`;
            }
            reportPath = path.join(projectRoot, '.taskmaster', 'reports', reportFileName);
        }

        let existingReport = { meta: {}, complexityAnalysis: [] };
        if (fs.existsSync(reportPath)) {
            existingReport = readJSON(reportPath) || existingReport;
            reportLog(`Found existing complexity report at ${path.relative(projectRoot, reportPath)}`);
            reportLog(`Existing report contains ${existingReport.complexityAnalysis.length} task analyses`);
        }

        const systemPrompt = `You are an expert software engineering lead. Your task is to analyze a list of software development tasks and provide a complexity analysis.

Analyze each task based on the following criteria:
- Uniqueness and Novelty: Is this a routine task or something new?
- Dependencies: How many other tasks or external systems does it depend on?
- Technical Uncertainty: Are there unknown technical challenges?
- Scope and Size: How large is the task?

Your response MUST be a single, valid JSON object and nothing else. The JSON object must contain a single key "complexityAnalysis", which is an array of objects.
For each task provided, create an object in the array with the following keys, ensuring all keys and string values are enclosed in double quotes:
- "taskId": (number) The ID of the task.
- "taskTitle": (string) The title of the task.
- "complexityScore": (number) A score from 1 (trivial) to 10 (highly complex).
- "estimatedHours": (number) A rough estimate of the time in hours to complete the task, assuming a single mid-to-senior level developer will be assigned to each individual task. The estimate should be done assuming no AI-assisted development.
- "reasoning": (string) A brief explanation for the score.
- "recommendedSubtasks": (number) A suggested number of subtasks to break it down into.
- "expansionPrompt": (string) A concise prompt for a separate AI to use to expand this task into subtasks.

IMPORTANT: Your output must be ONLY the JSON object. Do not include any other text, explanations, or markdown fences. The JSON must be perfectly formed, with double-quoted keys and string values, and no trailing commas.

EXAMPLE of a PERFECT response for a single task:
{
  "complexityAnalysis": [
    {
      "taskId": 101,
      "taskTitle": "Example Task",
      "complexityScore": 5,
      "estimatedHours": 8,
      "reasoning": "This is a sample reasoning.",
      "recommendedSubtasks": 3,
      "expansionPrompt": "Break down the example task."
    }
  ]
}`;

        const userPrompt = `Analyze the following tasks and return the complexity analysis in the specified JSON format:\n\n${JSON.stringify(tasksToAnalyze, null, 2)}`;

        if (debug) {
            reportLog(`System Prompt:\n${systemPrompt}`, 'debug');
            reportLog(`User Prompt:\n${userPrompt}`, 'debug');
        }

        const aiResponse = await generateTextService({
            prompt: userPrompt,
            systemPrompt: systemPrompt,
            role: 'main',
            session: session,
            projectRoot: projectRoot,
            commandName: 'analyze-complexity',
            outputType: outputFormat,
            useResearch: research
        });

        if (spinner) spinner.text = 'AI service call complete. Parsing response...';

        const cleanedJsonString = fixMalformedJson(aiResponse.mainResult);

        let analysisResult;
        try {
            reportLog('Parsing complexity analysis from text response...', 'info');
            analysisResult = JSON.parse(cleanedJsonString);
        } catch (parseError) {
            reportLog(`Error parsing complexity analysis JSON: ${parseError.message}`, 'error');
            if (debug) {
                reportLog(`Original AI response:\n${aiResponse.mainResult}`, 'debug');
                reportLog(`Cleaned AI response that failed parsing:\n${cleanedJsonString}`, 'debug');
            }
            throw new Error(`Error parsing complexity analysis JSON: ${parseError.message}`);
        }

        const newAnalysis = analysisResult.complexityAnalysis || [];

        const totalEstimatedHours = newAnalysis.reduce((sum, task) => sum + (task.estimatedHours || 0), 0);

        const finalReport = {
            meta: {
                ...existingReport.meta,
                generatedAt: new Date().toISOString(),
                tasksAnalyzed: newAnalysis.length,
                totalTasks: tasksToAnalyze.length,
                analysisCount: (existingReport.meta.analysisCount || 0) + 1,
                thresholdScore: options.threshold || 5,
                projectName: projectName,
                usedResearch: research || false,
                totalEstimatedHours: totalEstimatedHours,
            },
            complexityAnalysis: newAnalysis
        };

        const reportDir = path.dirname(reportPath);
        if (!fs.existsSync(reportDir)) {
            fs.mkdirSync(reportDir, { recursive: true });
        }

        writeJSON(reportPath, finalReport, projectRoot);

        if (spinner) spinner.succeed(chalk.green(`Complexity analysis complete. Report saved to ${path.relative(projectRoot, reportPath)}`));

        const complexTasks = tasksToAnalyze.filter(task =>
                newAnalysis.some(analysis => analysis.taskId === task.id && analysis.complexityScore >= (finalReport.meta.thresholdScore || 5))
            );

        if (clarify) {
            reportLog('Proceeding to generate clarifying questions for complex tasks...', 'info');
            if (spinner) spinner.text = 'Generating clarifying questions for complex tasks...';
            
            if (complexTasks.length > 0) {
                const clarificationResult = await generateClarifyingQuestions({ 
                    tasksData: { tasks: complexTasks },
                    project: projectName 
                }, context);
                
                if (clarificationResult.success && clarificationResult.data.filePath) {
                    reportLog(`Clarifying questions document generated at: ${clarificationResult.data.filePath}`, 'info');
                    await waitForUserConfirmation(clarificationResult.data.filePath);
                    
                    if (spinner) spinner.start('Re-analyzing complexity with updated context...');

                    const updatedContext = fs.readFileSync(clarificationResult.data.filePath, 'utf8');

                    const reanalysisUserPrompt = `The initial tasks to analyze are:\n${JSON.stringify(tasksToAnalyze, null, 2)}\n\nHere are the clarifying questions and the developer's answers. Use this additional context to refine your complexity analysis:\n\n${updatedContext}\n\nNow, re-analyze the original tasks based on this new information and return the refined complexity analysis in the specified JSON format.`;

                    if (debug) {
                        reportLog(`Re-analysis User Prompt:\n${reanalysisUserPrompt}`, 'debug');
                    }

                    const reanalysisResponse = await generateTextService({
                        prompt: reanalysisUserPrompt,
                        systemPrompt: systemPrompt,
                        role: 'main',
                        session: session,
                        projectRoot: projectRoot,
                        commandName: 'analyze-complexity-rerun',
                        outputType: outputFormat,
                        useResearch: research
                    });

                    if (spinner) spinner.text = 'AI re-analysis complete. Parsing response...';

                    const cleanedReanalysisJsonString = fixMalformedJson(reanalysisResponse.mainResult);

                    let reanalysisResult;

                    try {
                        reanalysisResult = JSON.parse(cleanedReanalysisJsonString);
                    } catch (parseError) {
                        reportLog(`Error parsing re-analysis JSON: ${parseError.message}`, 'error');
                        if (debug) {
                            reportLog(`Original re-analysis AI response:\n${reanalysisResponse.mainResult}`, 'debug');
                            reportLog(`Cleaned re-analysis AI response that failed parsing:\n${cleanedReanalysisJsonString}`, 'debug');
                        }
                        return { success: false, error: parseError.message };
                    }

                    const refinedAnalysis = reanalysisResult.complexityAnalysis || [];
                    
                    const refinedTotalEstimatedHours = refinedAnalysis.reduce((sum, task) => sum + (task.estimatedHours || 0), 0);

                    const refinedReport = {
                        meta: {
                            ...existingReport.meta,
                            generatedAt: new Date().toISOString(),
                            tasksAnalyzed: refinedAnalysis.length,
                            totalTasks: tasksToAnalyze.length,
                            analysisCount: (existingReport.meta.analysisCount || 0) + 1,
                            thresholdScore: options.threshold || 5,
                            projectName: projectName,
                            usedResearch: research || false,
                            totalEstimatedHours: refinedTotalEstimatedHours,
                            clarificationProvided: true,
                        },
                        complexityAnalysis: refinedAnalysis
                    };

                    writeJSON(reportPath, refinedReport, projectRoot);

                    if (spinner) spinner.succeed(chalk.green(`Refined complexity analysis complete. Report updated at ${path.relative(projectRoot, reportPath)}`));
                    
                    return { success: true, data: { reportPath, analysis: refinedAnalysis } };
                } else {
                    reportLog('Failed to generate clarifying questions document.', 'error');
                    reportLog(`Clarifying questions generation error: ${clarificationResult.error}`, 'error');
                    reportLog('Proceeding with the analysis without clarifying questions.', 'warn');
                }
            } else {
                reportLog('No tasks met the complexity threshold for clarification.', 'info');
            }
        }

        return { success: true, data: { reportPath, analysis: newAnalysis } };

    } catch (error) {
        if (spinner) {
            // Check if it's the user abort error to provide a cleaner message
            if (error.message === 'User aborted analysis.') {
                spinner.warn(chalk.yellow('Analysis aborted by user.'));
            } else {
                spinner.fail(chalk.red(error.message));
            }
        }
        
        reportLog(`Error analyzing task complexity: ${error.message}`, 'error');
        if (debug) {
            console.error(error);
        }
        return { success: false, error: error.message };
    }
}

export default analyzeTaskComplexity;
