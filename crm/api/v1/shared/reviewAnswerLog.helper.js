// ***************************************************
// * A review answer, as the change log names it
// ***************************************************
//
// Lives on tb_monthly_review, logged on the deal it answers, so History
// shows it and its undo goes back through the review repo, stop and all.
const REVIEW_ANSWER_FIELD = 'reviewAnswer';

const isReviewAnswerField = (field) => field === REVIEW_ANSWER_FIELD;

module.exports = { REVIEW_ANSWER_FIELD, isReviewAnswerField };
