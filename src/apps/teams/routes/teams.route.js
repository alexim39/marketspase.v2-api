import express from 'express';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { 
    saveTeam, getTeamsCreatedBy, getTeamBy, updateTeamBy, deleteTeamBy, addTeamMember, deleteTeamMember, getTeamsByCreatorOrPartner
} from '../controllers/team.controller.js'
const TeamsRouter = express.Router();

// All team writes are session-owned (creator/member checks inside use the
// session, never client-supplied ids). Reads are creator/member/admin scoped.
// create
TeamsRouter.post('/create', requireAuth, saveTeam);
// get teams created by partner
TeamsRouter.get('/all-createdBy/:partnerId', requireAuth, getTeamsCreatedBy);
// get teams created by partner or a member of the team
TeamsRouter.get('/all-createdByOrMember/:partnerId', requireAuth, getTeamsByCreatorOrPartner);
// get team
TeamsRouter.get('/:id', requireAuth, getTeamBy);
// delete team
TeamsRouter.delete('/:id', requireAuth, deleteTeamBy);
// update team
TeamsRouter.put('/', requireAuth, updateTeamBy);
// add member
TeamsRouter.post('/add-member', requireAuth, addTeamMember);
// delete team member
TeamsRouter.delete('/remove-member/:teamId/:memberId', requireAuth, deleteTeamMember);


export default TeamsRouter;
