import express from 'express';
const app = express();
app.use(express.json()); // Use json middleware
app.use(express.urlencoded({extended: false})); // Use formdata middleware
import SurveyRouter from './routes/survey.route.js';
export default SurveyRouter;