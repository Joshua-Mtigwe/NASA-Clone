-- AEGIS database schema: 49 seed tables (one per CSV) + backend runtime tables.
-- Tables are ordered parents-first. Generated from data/seed, then maintained by hand.
-- Empty CSV values load as NULL. Timestamps are ISO-8601 UTC text (sorts correctly).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS missions (
    mission_id TEXT PRIMARY KEY NOT NULL,
    mission_name TEXT,
    mission_type TEXT,
    launch_date TEXT,
    planned_end_date TEXT,
    actual_end_date TEXT,
    mission_status TEXT
);

CREATE TABLE IF NOT EXISTS roles (
    role_id TEXT PRIMARY KEY NOT NULL,
    role_name TEXT,
    description TEXT
);

CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY NOT NULL,
    username TEXT,
    email TEXT,
    password_hash TEXT,
    role_id TEXT,
    account_status TEXT,
    created_at TEXT,
    last_login_at TEXT,
    FOREIGN KEY (role_id) REFERENCES roles(role_id)
);

CREATE TABLE IF NOT EXISTS astronauts (
    astronaut_id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT,
    astronaut_code TEXT,
    specialization TEXT,
    mission_id TEXT,
    crew_role TEXT,
    medical_clearance_status TEXT,
    created_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    FOREIGN KEY (mission_id) REFERENCES missions(mission_id)
);

CREATE TABLE IF NOT EXISTS activity_records (
    activity_id TEXT PRIMARY KEY NOT NULL,
    astronaut_id TEXT,
    mission_id TEXT,
    activity_type TEXT,
    start_time TEXT,
    end_time TEXT,
    duration_minutes INTEGER,
    physical_intensity TEXT,
    cognitive_workload REAL,
    heart_rate_average REAL,
    perceived_exertion REAL,
    source_type TEXT,
    FOREIGN KEY (astronaut_id) REFERENCES astronauts(astronaut_id),
    FOREIGN KEY (mission_id) REFERENCES missions(mission_id)
);

CREATE TABLE IF NOT EXISTS simulation_runs (
    simulation_run_id TEXT PRIMARY KEY NOT NULL,
    mission_id TEXT,
    run_name TEXT,
    start_mission_time TEXT,
    current_mission_time TEXT,
    speed_multiplier INTEGER,
    status TEXT,
    created_at TEXT,
    data_mode TEXT,
    FOREIGN KEY (mission_id) REFERENCES missions(mission_id)
);

CREATE TABLE IF NOT EXISTS ai_inference_logs (
    inference_id TEXT PRIMARY KEY NOT NULL,
    simulation_run_id TEXT,
    purpose TEXT,
    model_id TEXT,
    model_version TEXT,
    prompt_template_version TEXT,
    input_hash TEXT,
    output_hash TEXT,
    status TEXT,
    latency_ms INTEGER,
    created_at TEXT,
    error_code TEXT,
    FOREIGN KEY (simulation_run_id) REFERENCES simulation_runs(simulation_run_id)
);

CREATE TABLE IF NOT EXISTS crew_readiness (
    readiness_id TEXT PRIMARY KEY NOT NULL,
    astronaut_id TEXT,
    mission_id TEXT,
    assessment_date TEXT,
    assessment_completion_status TEXT,
    operational_eligibility_status TEXT,
    workload_limit_minutes INTEGER,
    restriction_codes TEXT,
    authorized_by_user_id TEXT,
    valid_until TEXT,
    FOREIGN KEY (astronaut_id) REFERENCES astronauts(astronaut_id),
    FOREIGN KEY (mission_id) REFERENCES missions(mission_id),
    FOREIGN KEY (authorized_by_user_id) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS daily_task_sets (
    task_set_id TEXT PRIMARY KEY NOT NULL,
    mission_id TEXT,
    mission_day INTEGER,
    task_date TEXT,
    scenario_code TEXT,
    scenario_name TEXT,
    origin TEXT,
    status TEXT,
    FOREIGN KEY (mission_id) REFERENCES missions(mission_id)
);

CREATE TABLE IF NOT EXISTS mission_tasks (
    task_id TEXT PRIMARY KEY NOT NULL,
    mission_id TEXT,
    task_set_id TEXT,
    task_date TEXT,
    task_title TEXT,
    task_description TEXT,
    task_category TEXT,
    priority TEXT,
    estimated_duration_minutes INTEGER,
    required_crew_count INTEGER,
    deadline TEXT,
    task_status TEXT,
    created_by_user_id TEXT,
    created_at TEXT,
    FOREIGN KEY (mission_id) REFERENCES missions(mission_id),
    FOREIGN KEY (task_set_id) REFERENCES daily_task_sets(task_set_id),
    FOREIGN KEY (created_by_user_id) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS ai_task_recommendations (
    recommendation_id TEXT PRIMARY KEY NOT NULL,
    task_id TEXT,
    astronaut_id TEXT,
    readiness_id TEXT,
    model_version TEXT,
    recommendation_status TEXT,
    recommendation_reason TEXT,
    constraint_check_status TEXT,
    generated_at TEXT,
    FOREIGN KEY (task_id) REFERENCES mission_tasks(task_id),
    FOREIGN KEY (astronaut_id) REFERENCES astronauts(astronaut_id),
    FOREIGN KEY (readiness_id) REFERENCES crew_readiness(readiness_id)
);

CREATE TABLE IF NOT EXISTS research_analyses (
    analysis_id TEXT PRIMARY KEY NOT NULL,
    researcher_user_id TEXT,
    mission_id TEXT,
    analysis_type TEXT,
    research_question TEXT,
    independent_variable TEXT,
    dependent_variable TEXT,
    analysis_method TEXT,
    date_range_start TEXT,
    date_range_end TEXT,
    created_at TEXT,
    FOREIGN KEY (researcher_user_id) REFERENCES users(user_id),
    FOREIGN KEY (mission_id) REFERENCES missions(mission_id)
);

CREATE TABLE IF NOT EXISTS analysis_jobs (
    job_id TEXT PRIMARY KEY NOT NULL,
    analysis_id TEXT,
    simulation_run_id TEXT,
    requested_by_user_id TEXT,
    method TEXT,
    status TEXT,
    submitted_at TEXT,
    started_at TEXT,
    completed_at TEXT,
    error_message TEXT,
    FOREIGN KEY (analysis_id) REFERENCES research_analyses(analysis_id),
    FOREIGN KEY (simulation_run_id) REFERENCES simulation_runs(simulation_run_id),
    FOREIGN KEY (requested_by_user_id) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS analysis_results (
    analysis_result_id TEXT PRIMARY KEY NOT NULL,
    analysis_id TEXT,
    metric_name TEXT,
    metric_value REAL,
    metric_unit TEXT,
    sample_size INTEGER,
    effect_estimate REAL,
    confidence_interval_lower REAL,
    confidence_interval_upper REAL,
    p_value REAL,
    interpretation TEXT,
    calculated_at TEXT,
    FOREIGN KEY (analysis_id) REFERENCES research_analyses(analysis_id)
);

CREATE TABLE IF NOT EXISTS assessment_protocols (
    protocol_id TEXT PRIMARY KEY NOT NULL,
    protocol_name TEXT,
    test_type TEXT,
    protocol_version TEXT,
    duration_seconds INTEGER,
    instructions TEXT,
    scoring_method TEXT,
    is_active TEXT
);

CREATE TABLE IF NOT EXISTS assessment_schedule_templates (
    template_id TEXT PRIMARY KEY NOT NULL,
    mission_phase TEXT,
    assessment_condition TEXT,
    local_hour INTEGER,
    protocol_ids TEXT,
    recurrence TEXT,
    description TEXT
);

CREATE TABLE IF NOT EXISTS assessment_assignments (
    assignment_id TEXT PRIMARY KEY NOT NULL,
    astronaut_id TEXT,
    protocol_id TEXT,
    assigned_by_user_id TEXT,
    scheduled_at TEXT,
    assessment_condition TEXT,
    access_status TEXT,
    access_expires_at TEXT,
    assignment_source TEXT,
    schedule_template_id TEXT,
    simulation_run_id TEXT,
    FOREIGN KEY (astronaut_id) REFERENCES astronauts(astronaut_id),
    FOREIGN KEY (protocol_id) REFERENCES assessment_protocols(protocol_id),
    FOREIGN KEY (assigned_by_user_id) REFERENCES users(user_id),
    FOREIGN KEY (schedule_template_id) REFERENCES assessment_schedule_templates(template_id),
    FOREIGN KEY (simulation_run_id) REFERENCES simulation_runs(simulation_run_id)
);

CREATE TABLE IF NOT EXISTS assessment_context (
    context_id TEXT PRIMARY KEY NOT NULL,
    astronaut_id TEXT,
    mission_id TEXT,
    timestamp_utc TEXT,
    circadian_condition TEXT,
    preceding_activity TEXT,
    prior_sleep_hours REAL,
    fatigue_score REAL,
    sleepiness_score REAL,
    perceived_workload REAL,
    time_since_waking_minutes INTEGER,
    source_type TEXT,
    FOREIGN KEY (astronaut_id) REFERENCES astronauts(astronaut_id),
    FOREIGN KEY (mission_id) REFERENCES missions(mission_id)
);

CREATE TABLE IF NOT EXISTS assessment_sessions (
    session_id TEXT PRIMARY KEY NOT NULL,
    assignment_id TEXT,
    astronaut_id TEXT,
    protocol_id TEXT,
    mission_id TEXT,
    mission_phase TEXT,
    assessment_condition TEXT,
    started_at TEXT,
    completed_at TEXT,
    session_status TEXT,
    quality_status TEXT,
    time_since_waking_minutes INTEGER,
    time_since_activity_minutes INTEGER,
    context_id TEXT,
    FOREIGN KEY (assignment_id) REFERENCES assessment_assignments(assignment_id),
    FOREIGN KEY (astronaut_id) REFERENCES astronauts(astronaut_id),
    FOREIGN KEY (protocol_id) REFERENCES assessment_protocols(protocol_id),
    FOREIGN KEY (mission_id) REFERENCES missions(mission_id),
    FOREIGN KEY (context_id) REFERENCES assessment_context(context_id)
);

CREATE TABLE IF NOT EXISTS assessment_results (
    result_id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT,
    cognitive_domain TEXT,
    metric_name TEXT,
    metric_value REAL,
    metric_unit TEXT,
    scoring_version TEXT,
    calculated_at TEXT,
    FOREIGN KEY (session_id) REFERENCES assessment_sessions(session_id)
);

CREATE TABLE IF NOT EXISTS assessment_trials (
    trial_id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT,
    trial_number INTEGER,
    stimulus_type TEXT,
    stimulus_value TEXT,
    expected_response TEXT,
    actual_response TEXT,
    reaction_time_ms REAL,
    is_correct INTEGER,
    is_lapse INTEGER,
    is_false_start INTEGER,
    trial_timestamp TEXT,
    FOREIGN KEY (session_id) REFERENCES assessment_sessions(session_id)
);

CREATE TABLE IF NOT EXISTS astronaut_qualifications (
    qualification_id TEXT PRIMARY KEY NOT NULL,
    astronaut_id TEXT,
    qualification_code TEXT,
    authorization_status TEXT,
    valid_from TEXT,
    valid_until TEXT,
    verified_by_user_id TEXT,
    source_type TEXT,
    FOREIGN KEY (astronaut_id) REFERENCES astronauts(astronaut_id),
    FOREIGN KEY (verified_by_user_id) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
    audit_id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT,
    action_type TEXT,
    entity_type TEXT,
    entity_id TEXT,
    action_timestamp TEXT,
    action_result TEXT,
    change_summary TEXT,
    FOREIGN KEY (user_id) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS cognitive_baselines (
    baseline_id TEXT PRIMARY KEY NOT NULL,
    astronaut_id TEXT,
    protocol_id TEXT,
    assessment_condition TEXT,
    cognitive_domain TEXT,
    metric_name TEXT,
    metric_unit TEXT,
    median_value REAL,
    mean_value REAL,
    standard_deviation REAL,
    reference_lower REAL,
    reference_upper REAL,
    sample_size INTEGER,
    baseline_version TEXT,
    calculated_at TEXT,
    FOREIGN KEY (astronaut_id) REFERENCES astronauts(astronaut_id),
    FOREIGN KEY (protocol_id) REFERENCES assessment_protocols(protocol_id)
);

CREATE TABLE IF NOT EXISTS daily_cognitive_results (
    daily_result_id TEXT PRIMARY KEY NOT NULL,
    astronaut_id TEXT,
    mission_id TEXT,
    mission_day INTEGER,
    assessment_date TEXT,
    protocol_id TEXT,
    cognitive_domain TEXT,
    metric_name TEXT,
    daily_mean REAL,
    daily_median REAL,
    metric_unit TEXT,
    sessions_completed INTEGER,
    valid_trials INTEGER,
    calculated_at TEXT,
    FOREIGN KEY (astronaut_id) REFERENCES astronauts(astronaut_id),
    FOREIGN KEY (mission_id) REFERENCES missions(mission_id),
    FOREIGN KEY (protocol_id) REFERENCES assessment_protocols(protocol_id)
);

CREATE TABLE IF NOT EXISTS cognitive_comparisons (
    comparison_id TEXT PRIMARY KEY NOT NULL,
    astronaut_id TEXT,
    daily_result_id TEXT,
    baseline_id TEXT,
    comparison_method TEXT,
    baseline_value REAL,
    inflight_value REAL,
    absolute_difference REAL,
    percentage_difference REAL,
    reference_range_status TEXT,
    calculated_at TEXT,
    FOREIGN KEY (astronaut_id) REFERENCES astronauts(astronaut_id),
    FOREIGN KEY (daily_result_id) REFERENCES daily_cognitive_results(daily_result_id),
    FOREIGN KEY (baseline_id) REFERENCES cognitive_baselines(baseline_id)
);

CREATE TABLE IF NOT EXISTS optimization_runs (
    optimization_run_id TEXT PRIMARY KEY NOT NULL,
    simulation_run_id TEXT,
    task_set_id TEXT,
    requested_by_user_id TEXT,
    solver_version TEXT,
    objective_version TEXT,
    status TEXT,
    started_at TEXT,
    finished_at TEXT,
    objective_value REAL,
    infeasibility_reason TEXT,
    input_hash TEXT,
    FOREIGN KEY (simulation_run_id) REFERENCES simulation_runs(simulation_run_id),
    FOREIGN KEY (task_set_id) REFERENCES daily_task_sets(task_set_id),
    FOREIGN KEY (requested_by_user_id) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS schedule_versions (
    schedule_version_id TEXT PRIMARY KEY NOT NULL,
    simulation_run_id TEXT,
    mission_id TEXT,
    task_set_id TEXT,
    version_number INTEGER,
    status TEXT,
    created_by_user_id TEXT,
    approved_by_user_id TEXT,
    created_at TEXT,
    approved_at TEXT,
    optimization_run_id TEXT,
    FOREIGN KEY (simulation_run_id) REFERENCES simulation_runs(simulation_run_id),
    FOREIGN KEY (mission_id) REFERENCES missions(mission_id),
    FOREIGN KEY (task_set_id) REFERENCES daily_task_sets(task_set_id),
    FOREIGN KEY (created_by_user_id) REFERENCES users(user_id),
    FOREIGN KEY (approved_by_user_id) REFERENCES users(user_id),
    FOREIGN KEY (optimization_run_id) REFERENCES optimization_runs(optimization_run_id)
);

CREATE TABLE IF NOT EXISTS daily_schedules (
    schedule_id TEXT PRIMARY KEY NOT NULL,
    astronaut_id TEXT,
    mission_id TEXT,
    schedule_date TEXT,
    activity_type TEXT,
    activity_reference_id TEXT,
    start_time TEXT,
    end_time TEXT,
    schedule_status TEXT,
    approved_by_user_id TEXT,
    schedule_version_id TEXT,
    simulation_run_id TEXT,
    approval_status TEXT,
    FOREIGN KEY (astronaut_id) REFERENCES astronauts(astronaut_id),
    FOREIGN KEY (mission_id) REFERENCES missions(mission_id),
    FOREIGN KEY (approved_by_user_id) REFERENCES users(user_id),
    FOREIGN KEY (schedule_version_id) REFERENCES schedule_versions(schedule_version_id),
    FOREIGN KEY (simulation_run_id) REFERENCES simulation_runs(simulation_run_id)
);

CREATE TABLE IF NOT EXISTS data_lineage (
    csv_filename TEXT PRIMARY KEY NOT NULL,
    row_count INTEGER,
    data_classification TEXT,
    source_ids TEXT,
    generation_seed INTEGER,
    provenance_note TEXT,
    source_file_checksum TEXT
);

CREATE TABLE IF NOT EXISTS data_sources (
    source_id TEXT PRIMARY KEY NOT NULL,
    title TEXT,
    organization TEXT,
    url TEXT,
    source_class TEXT,
    usage_note TEXT
);

CREATE TABLE IF NOT EXISTS sensors (
    sensor_id TEXT PRIMARY KEY NOT NULL,
    sensor_name TEXT,
    sensor_type TEXT,
    device_model TEXT,
    serial_number TEXT,
    measurement_unit TEXT,
    sampling_rate_hz REAL,
    calibration_date TEXT,
    sensor_status TEXT
);

CREATE TABLE IF NOT EXISTS environment_readings (
    environment_reading_id TEXT PRIMARY KEY NOT NULL,
    sensor_id TEXT,
    mission_id TEXT,
    timestamp_utc TEXT,
    measurement_type TEXT,
    measurement_value REAL,
    measurement_unit TEXT,
    location TEXT,
    quality_status TEXT,
    source_type TEXT,
    FOREIGN KEY (sensor_id) REFERENCES sensors(sensor_id),
    FOREIGN KEY (mission_id) REFERENCES missions(mission_id)
);

CREATE TABLE IF NOT EXISTS metric_definitions (
    metric_id TEXT PRIMARY KEY NOT NULL,
    metric_name TEXT,
    cognitive_domain TEXT,
    metric_unit TEXT,
    better_direction TEXT,
    scoring_protocol_version TEXT,
    reference_method TEXT,
    clinical_threshold_validated TEXT,
    source_type TEXT
);

CREATE TABLE IF NOT EXISTS organ_dose_estimates (
    estimate_id TEXT PRIMARY KEY NOT NULL,
    astronaut_id TEXT,
    mission_id TEXT,
    body_region TEXT,
    organ_name TEXT,
    estimated_dose REAL,
    dose_unit TEXT,
    model_name TEXT,
    model_version TEXT,
    uncertainty TEXT,
    timestamp_utc TEXT,
    FOREIGN KEY (astronaut_id) REFERENCES astronauts(astronaut_id),
    FOREIGN KEY (mission_id) REFERENCES missions(mission_id)
);

CREATE TABLE IF NOT EXISTS planning_effectiveness (
    effectiveness_id TEXT PRIMARY KEY NOT NULL,
    mission_id TEXT,
    evaluation_period_start TEXT,
    evaluation_period_end TEXT,
    planning_method TEXT,
    cognitive_metric_name TEXT,
    cognitive_metric_value REAL,
    workload_balance_metric REAL,
    task_completion_rate REAL,
    schedule_adherence_rate REAL,
    recovery_adherence_rate REAL,
    evaluation_method TEXT,
    analysis_id TEXT,
    FOREIGN KEY (mission_id) REFERENCES missions(mission_id),
    FOREIGN KEY (analysis_id) REFERENCES research_analyses(analysis_id)
);

CREATE TABLE IF NOT EXISTS radiation_readings (
    radiation_reading_id TEXT PRIMARY KEY NOT NULL,
    sensor_id TEXT,
    astronaut_id TEXT,
    mission_id TEXT,
    timestamp_utc TEXT,
    dose_rate REAL,
    dose_rate_unit TEXT,
    accumulated_dose REAL,
    accumulated_dose_unit TEXT,
    particle_count TEXT,
    detector_location TEXT,
    source_type TEXT,
    FOREIGN KEY (sensor_id) REFERENCES sensors(sensor_id),
    FOREIGN KEY (astronaut_id) REFERENCES astronauts(astronaut_id),
    FOREIGN KEY (mission_id) REFERENCES missions(mission_id)
);

CREATE TABLE IF NOT EXISTS recovery_activities (
    recovery_activity_id TEXT PRIMARY KEY NOT NULL,
    activity_name TEXT,
    activity_category TEXT,
    recommended_duration_minutes INTEGER,
    description TEXT,
    instructions TEXT,
    intensity TEXT,
    approval_status TEXT,
    approved_by_user_id TEXT,
    FOREIGN KEY (approved_by_user_id) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS recovery_recommendations (
    recommendation_id TEXT PRIMARY KEY NOT NULL,
    astronaut_id TEXT,
    recovery_activity_id TEXT,
    mission_day INTEGER,
    recommendation_score REAL,
    reason TEXT,
    algorithm_version TEXT,
    constraint_status TEXT,
    approval_status TEXT,
    created_at TEXT,
    FOREIGN KEY (astronaut_id) REFERENCES astronauts(astronaut_id),
    FOREIGN KEY (recovery_activity_id) REFERENCES recovery_activities(recovery_activity_id)
);

CREATE TABLE IF NOT EXISTS research_reports (
    report_id TEXT PRIMARY KEY NOT NULL,
    analysis_id TEXT,
    simulation_run_id TEXT,
    title TEXT,
    status TEXT,
    model_id TEXT,
    evidence_hash TEXT,
    report_text TEXT,
    created_at TEXT,
    reviewed_by_user_id TEXT,
    reviewed_at TEXT,
    data_classification TEXT,
    FOREIGN KEY (analysis_id) REFERENCES research_analyses(analysis_id),
    FOREIGN KEY (simulation_run_id) REFERENCES simulation_runs(simulation_run_id),
    FOREIGN KEY (reviewed_by_user_id) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS scheduled_recovery (
    scheduled_recovery_id TEXT PRIMARY KEY NOT NULL,
    astronaut_id TEXT,
    mission_id TEXT,
    recovery_activity_id TEXT,
    schedule_id TEXT,
    scheduled_start TEXT,
    scheduled_end TEXT,
    completion_status TEXT,
    completed_at TEXT,
    astronaut_feedback TEXT,
    FOREIGN KEY (astronaut_id) REFERENCES astronauts(astronaut_id),
    FOREIGN KEY (mission_id) REFERENCES missions(mission_id),
    FOREIGN KEY (recovery_activity_id) REFERENCES recovery_activities(recovery_activity_id),
    FOREIGN KEY (schedule_id) REFERENCES daily_schedules(schedule_id)
);

CREATE TABLE IF NOT EXISTS sensor_readings (
    reading_id TEXT PRIMARY KEY NOT NULL,
    sensor_id TEXT,
    astronaut_id TEXT,
    mission_id TEXT,
    timestamp_utc TEXT,
    measurement_type TEXT,
    measurement_value REAL,
    measurement_unit TEXT,
    quality_status TEXT,
    source_type TEXT,
    measurement_method TEXT,
    FOREIGN KEY (sensor_id) REFERENCES sensors(sensor_id),
    FOREIGN KEY (astronaut_id) REFERENCES astronauts(astronaut_id),
    FOREIGN KEY (mission_id) REFERENCES missions(mission_id)
);

CREATE TABLE IF NOT EXISTS simulation_events (
    event_id TEXT PRIMARY KEY NOT NULL,
    simulation_run_id TEXT,
    mission_id TEXT,
    mission_day INTEGER,
    event_timestamp TEXT,
    event_type TEXT,
    event_title TEXT,
    description TEXT,
    severity TEXT,
    source_type TEXT,
    FOREIGN KEY (simulation_run_id) REFERENCES simulation_runs(simulation_run_id),
    FOREIGN KEY (mission_id) REFERENCES missions(mission_id)
);

CREATE TABLE IF NOT EXISTS sleep_records (
    sleep_id TEXT PRIMARY KEY NOT NULL,
    astronaut_id TEXT,
    mission_id TEXT,
    sleep_start TEXT,
    sleep_end TEXT,
    total_sleep_minutes REAL,
    sleep_efficiency_percent REAL,
    awakenings_count INTEGER,
    sleep_quality_score REAL,
    data_source TEXT,
    quality_status TEXT,
    FOREIGN KEY (astronaut_id) REFERENCES astronauts(astronaut_id),
    FOREIGN KEY (mission_id) REFERENCES missions(mission_id)
);

CREATE TABLE IF NOT EXISTS sync_events (
    sync_id TEXT PRIMARY KEY NOT NULL,
    device_id TEXT,
    mission_id TEXT,
    entity_type TEXT,
    entity_id TEXT,
    sync_direction TEXT,
    sync_status TEXT,
    last_attempt_at TEXT,
    completed_at TEXT,
    error_message TEXT,
    FOREIGN KEY (mission_id) REFERENCES missions(mission_id)
);

CREATE TABLE IF NOT EXISTS sync_conflicts (
    conflict_id TEXT PRIMARY KEY NOT NULL,
    sync_id TEXT,
    entity_type TEXT,
    entity_id TEXT,
    local_version TEXT,
    remote_version TEXT,
    resolution_status TEXT,
    resolved_by_user_id TEXT,
    resolved_at TEXT,
    resolution_notes TEXT,
    FOREIGN KEY (sync_id) REFERENCES sync_events(sync_id),
    FOREIGN KEY (resolved_by_user_id) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS task_assignments (
    task_assignment_id TEXT PRIMARY KEY NOT NULL,
    task_id TEXT,
    astronaut_id TEXT,
    recommendation_id TEXT,
    assigned_by_user_id TEXT,
    assignment_status TEXT,
    planned_start TEXT,
    planned_end TEXT,
    actual_start TEXT,
    actual_end TEXT,
    approval_status TEXT,
    approved_at TEXT,
    schedule_version_id TEXT,
    simulation_run_id TEXT,
    FOREIGN KEY (task_id) REFERENCES mission_tasks(task_id),
    FOREIGN KEY (astronaut_id) REFERENCES astronauts(astronaut_id),
    FOREIGN KEY (recommendation_id) REFERENCES ai_task_recommendations(recommendation_id),
    FOREIGN KEY (assigned_by_user_id) REFERENCES users(user_id),
    FOREIGN KEY (schedule_version_id) REFERENCES schedule_versions(schedule_version_id),
    FOREIGN KEY (simulation_run_id) REFERENCES simulation_runs(simulation_run_id)
);

CREATE TABLE IF NOT EXISTS task_dependencies (
    dependency_id TEXT PRIMARY KEY NOT NULL,
    task_id TEXT,
    depends_on_task_id TEXT,
    dependency_type TEXT,
    FOREIGN KEY (task_id) REFERENCES mission_tasks(task_id),
    FOREIGN KEY (depends_on_task_id) REFERENCES mission_tasks(task_id)
);

CREATE TABLE IF NOT EXISTS task_requirements (
    requirement_id TEXT PRIMARY KEY NOT NULL,
    task_id TEXT,
    required_specialization TEXT,
    required_certification TEXT,
    cognitive_demand_score REAL,
    physical_demand_score INTEGER,
    attention_demand_score INTEGER,
    time_pressure_score INTEGER,
    safety_classification TEXT,
    review_status TEXT,
    reviewed_by_user_id TEXT,
    FOREIGN KEY (task_id) REFERENCES mission_tasks(task_id),
    FOREIGN KEY (reviewed_by_user_id) REFERENCES users(user_id)
);

-- Indexes on keys, astronaut/mission/run/version IDs and timestamps
CREATE INDEX IF NOT EXISTS ix_users_role_id ON users(role_id);
CREATE INDEX IF NOT EXISTS ix_astronauts_user_id ON astronauts(user_id);
CREATE INDEX IF NOT EXISTS ix_astronauts_mission_id ON astronauts(mission_id);
CREATE INDEX IF NOT EXISTS ix_activity_records_astronaut_id ON activity_records(astronaut_id);
CREATE INDEX IF NOT EXISTS ix_activity_records_mission_id ON activity_records(mission_id);
CREATE INDEX IF NOT EXISTS ix_simulation_runs_mission_id ON simulation_runs(mission_id);
CREATE INDEX IF NOT EXISTS ix_ai_inference_logs_simulation_run_id ON ai_inference_logs(simulation_run_id);
CREATE INDEX IF NOT EXISTS ix_crew_readiness_astronaut_id ON crew_readiness(astronaut_id);
CREATE INDEX IF NOT EXISTS ix_crew_readiness_mission_id ON crew_readiness(mission_id);
CREATE INDEX IF NOT EXISTS ix_crew_readiness_assessment_date ON crew_readiness(assessment_date);
CREATE INDEX IF NOT EXISTS ix_crew_readiness_authorized_by_user_id ON crew_readiness(authorized_by_user_id);
CREATE INDEX IF NOT EXISTS ix_daily_task_sets_mission_id ON daily_task_sets(mission_id);
CREATE INDEX IF NOT EXISTS ix_daily_task_sets_mission_day ON daily_task_sets(mission_day);
CREATE INDEX IF NOT EXISTS ix_daily_task_sets_task_date ON daily_task_sets(task_date);
CREATE INDEX IF NOT EXISTS ix_mission_tasks_mission_id ON mission_tasks(mission_id);
CREATE INDEX IF NOT EXISTS ix_mission_tasks_task_set_id ON mission_tasks(task_set_id);
CREATE INDEX IF NOT EXISTS ix_mission_tasks_task_date ON mission_tasks(task_date);
CREATE INDEX IF NOT EXISTS ix_mission_tasks_created_by_user_id ON mission_tasks(created_by_user_id);
CREATE INDEX IF NOT EXISTS ix_ai_task_recommendations_task_id ON ai_task_recommendations(task_id);
CREATE INDEX IF NOT EXISTS ix_ai_task_recommendations_astronaut_id ON ai_task_recommendations(astronaut_id);
CREATE INDEX IF NOT EXISTS ix_ai_task_recommendations_readiness_id ON ai_task_recommendations(readiness_id);
CREATE INDEX IF NOT EXISTS ix_research_analyses_researcher_user_id ON research_analyses(researcher_user_id);
CREATE INDEX IF NOT EXISTS ix_research_analyses_mission_id ON research_analyses(mission_id);
CREATE INDEX IF NOT EXISTS ix_analysis_jobs_analysis_id ON analysis_jobs(analysis_id);
CREATE INDEX IF NOT EXISTS ix_analysis_jobs_simulation_run_id ON analysis_jobs(simulation_run_id);
CREATE INDEX IF NOT EXISTS ix_analysis_jobs_requested_by_user_id ON analysis_jobs(requested_by_user_id);
CREATE INDEX IF NOT EXISTS ix_analysis_results_analysis_id ON analysis_results(analysis_id);
CREATE INDEX IF NOT EXISTS ix_assessment_assignments_astronaut_id ON assessment_assignments(astronaut_id);
CREATE INDEX IF NOT EXISTS ix_assessment_assignments_protocol_id ON assessment_assignments(protocol_id);
CREATE INDEX IF NOT EXISTS ix_assessment_assignments_assigned_by_user_id ON assessment_assignments(assigned_by_user_id);
CREATE INDEX IF NOT EXISTS ix_assessment_assignments_scheduled_at ON assessment_assignments(scheduled_at);
CREATE INDEX IF NOT EXISTS ix_assessment_assignments_schedule_template_id ON assessment_assignments(schedule_template_id);
CREATE INDEX IF NOT EXISTS ix_assessment_assignments_simulation_run_id ON assessment_assignments(simulation_run_id);
CREATE INDEX IF NOT EXISTS ix_assessment_context_astronaut_id ON assessment_context(astronaut_id);
CREATE INDEX IF NOT EXISTS ix_assessment_context_mission_id ON assessment_context(mission_id);
CREATE INDEX IF NOT EXISTS ix_assessment_context_timestamp_utc ON assessment_context(timestamp_utc);
CREATE INDEX IF NOT EXISTS ix_assessment_sessions_assignment_id ON assessment_sessions(assignment_id);
CREATE INDEX IF NOT EXISTS ix_assessment_sessions_astronaut_id ON assessment_sessions(astronaut_id);
CREATE INDEX IF NOT EXISTS ix_assessment_sessions_protocol_id ON assessment_sessions(protocol_id);
CREATE INDEX IF NOT EXISTS ix_assessment_sessions_mission_id ON assessment_sessions(mission_id);
CREATE INDEX IF NOT EXISTS ix_assessment_sessions_context_id ON assessment_sessions(context_id);
CREATE INDEX IF NOT EXISTS ix_assessment_results_session_id ON assessment_results(session_id);
CREATE INDEX IF NOT EXISTS ix_assessment_trials_session_id ON assessment_trials(session_id);
CREATE INDEX IF NOT EXISTS ix_astronaut_qualifications_astronaut_id ON astronaut_qualifications(astronaut_id);
CREATE INDEX IF NOT EXISTS ix_astronaut_qualifications_verified_by_user_id ON astronaut_qualifications(verified_by_user_id);
CREATE INDEX IF NOT EXISTS ix_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS ix_cognitive_baselines_astronaut_id ON cognitive_baselines(astronaut_id);
CREATE INDEX IF NOT EXISTS ix_cognitive_baselines_protocol_id ON cognitive_baselines(protocol_id);
CREATE INDEX IF NOT EXISTS ix_daily_cognitive_results_astronaut_id ON daily_cognitive_results(astronaut_id);
CREATE INDEX IF NOT EXISTS ix_daily_cognitive_results_mission_id ON daily_cognitive_results(mission_id);
CREATE INDEX IF NOT EXISTS ix_daily_cognitive_results_mission_day ON daily_cognitive_results(mission_day);
CREATE INDEX IF NOT EXISTS ix_daily_cognitive_results_assessment_date ON daily_cognitive_results(assessment_date);
CREATE INDEX IF NOT EXISTS ix_daily_cognitive_results_protocol_id ON daily_cognitive_results(protocol_id);
CREATE INDEX IF NOT EXISTS ix_cognitive_comparisons_astronaut_id ON cognitive_comparisons(astronaut_id);
CREATE INDEX IF NOT EXISTS ix_cognitive_comparisons_daily_result_id ON cognitive_comparisons(daily_result_id);
CREATE INDEX IF NOT EXISTS ix_cognitive_comparisons_baseline_id ON cognitive_comparisons(baseline_id);
CREATE INDEX IF NOT EXISTS ix_optimization_runs_simulation_run_id ON optimization_runs(simulation_run_id);
CREATE INDEX IF NOT EXISTS ix_optimization_runs_task_set_id ON optimization_runs(task_set_id);
CREATE INDEX IF NOT EXISTS ix_optimization_runs_requested_by_user_id ON optimization_runs(requested_by_user_id);
CREATE INDEX IF NOT EXISTS ix_schedule_versions_simulation_run_id ON schedule_versions(simulation_run_id);
CREATE INDEX IF NOT EXISTS ix_schedule_versions_mission_id ON schedule_versions(mission_id);
CREATE INDEX IF NOT EXISTS ix_schedule_versions_task_set_id ON schedule_versions(task_set_id);
CREATE INDEX IF NOT EXISTS ix_schedule_versions_created_by_user_id ON schedule_versions(created_by_user_id);
CREATE INDEX IF NOT EXISTS ix_schedule_versions_approved_by_user_id ON schedule_versions(approved_by_user_id);
CREATE INDEX IF NOT EXISTS ix_schedule_versions_optimization_run_id ON schedule_versions(optimization_run_id);
CREATE INDEX IF NOT EXISTS ix_daily_schedules_astronaut_id ON daily_schedules(astronaut_id);
CREATE INDEX IF NOT EXISTS ix_daily_schedules_mission_id ON daily_schedules(mission_id);
CREATE INDEX IF NOT EXISTS ix_daily_schedules_schedule_date ON daily_schedules(schedule_date);
CREATE INDEX IF NOT EXISTS ix_daily_schedules_approved_by_user_id ON daily_schedules(approved_by_user_id);
CREATE INDEX IF NOT EXISTS ix_daily_schedules_schedule_version_id ON daily_schedules(schedule_version_id);
CREATE INDEX IF NOT EXISTS ix_daily_schedules_simulation_run_id ON daily_schedules(simulation_run_id);
CREATE INDEX IF NOT EXISTS ix_environment_readings_sensor_id ON environment_readings(sensor_id);
CREATE INDEX IF NOT EXISTS ix_environment_readings_mission_id ON environment_readings(mission_id);
CREATE INDEX IF NOT EXISTS ix_environment_readings_timestamp_utc ON environment_readings(timestamp_utc);
CREATE INDEX IF NOT EXISTS ix_organ_dose_estimates_astronaut_id ON organ_dose_estimates(astronaut_id);
CREATE INDEX IF NOT EXISTS ix_organ_dose_estimates_mission_id ON organ_dose_estimates(mission_id);
CREATE INDEX IF NOT EXISTS ix_organ_dose_estimates_timestamp_utc ON organ_dose_estimates(timestamp_utc);
CREATE INDEX IF NOT EXISTS ix_planning_effectiveness_mission_id ON planning_effectiveness(mission_id);
CREATE INDEX IF NOT EXISTS ix_planning_effectiveness_analysis_id ON planning_effectiveness(analysis_id);
CREATE INDEX IF NOT EXISTS ix_radiation_readings_sensor_id ON radiation_readings(sensor_id);
CREATE INDEX IF NOT EXISTS ix_radiation_readings_astronaut_id ON radiation_readings(astronaut_id);
CREATE INDEX IF NOT EXISTS ix_radiation_readings_mission_id ON radiation_readings(mission_id);
CREATE INDEX IF NOT EXISTS ix_radiation_readings_timestamp_utc ON radiation_readings(timestamp_utc);
CREATE INDEX IF NOT EXISTS ix_recovery_activities_approved_by_user_id ON recovery_activities(approved_by_user_id);
CREATE INDEX IF NOT EXISTS ix_recovery_recommendations_astronaut_id ON recovery_recommendations(astronaut_id);
CREATE INDEX IF NOT EXISTS ix_recovery_recommendations_recovery_activity_id ON recovery_recommendations(recovery_activity_id);
CREATE INDEX IF NOT EXISTS ix_recovery_recommendations_mission_day ON recovery_recommendations(mission_day);
CREATE INDEX IF NOT EXISTS ix_research_reports_analysis_id ON research_reports(analysis_id);
CREATE INDEX IF NOT EXISTS ix_research_reports_simulation_run_id ON research_reports(simulation_run_id);
CREATE INDEX IF NOT EXISTS ix_research_reports_reviewed_by_user_id ON research_reports(reviewed_by_user_id);
CREATE INDEX IF NOT EXISTS ix_scheduled_recovery_astronaut_id ON scheduled_recovery(astronaut_id);
CREATE INDEX IF NOT EXISTS ix_scheduled_recovery_mission_id ON scheduled_recovery(mission_id);
CREATE INDEX IF NOT EXISTS ix_scheduled_recovery_recovery_activity_id ON scheduled_recovery(recovery_activity_id);
CREATE INDEX IF NOT EXISTS ix_scheduled_recovery_schedule_id ON scheduled_recovery(schedule_id);
CREATE INDEX IF NOT EXISTS ix_sensor_readings_sensor_id ON sensor_readings(sensor_id);
CREATE INDEX IF NOT EXISTS ix_sensor_readings_astronaut_id ON sensor_readings(astronaut_id);
CREATE INDEX IF NOT EXISTS ix_sensor_readings_mission_id ON sensor_readings(mission_id);
CREATE INDEX IF NOT EXISTS ix_sensor_readings_timestamp_utc ON sensor_readings(timestamp_utc);
CREATE INDEX IF NOT EXISTS ix_simulation_events_simulation_run_id ON simulation_events(simulation_run_id);
CREATE INDEX IF NOT EXISTS ix_simulation_events_mission_id ON simulation_events(mission_id);
CREATE INDEX IF NOT EXISTS ix_simulation_events_mission_day ON simulation_events(mission_day);
CREATE INDEX IF NOT EXISTS ix_sleep_records_astronaut_id ON sleep_records(astronaut_id);
CREATE INDEX IF NOT EXISTS ix_sleep_records_mission_id ON sleep_records(mission_id);
CREATE INDEX IF NOT EXISTS ix_sync_events_mission_id ON sync_events(mission_id);
CREATE INDEX IF NOT EXISTS ix_sync_conflicts_sync_id ON sync_conflicts(sync_id);
CREATE INDEX IF NOT EXISTS ix_sync_conflicts_resolved_by_user_id ON sync_conflicts(resolved_by_user_id);
CREATE INDEX IF NOT EXISTS ix_task_assignments_task_id ON task_assignments(task_id);
CREATE INDEX IF NOT EXISTS ix_task_assignments_astronaut_id ON task_assignments(astronaut_id);
CREATE INDEX IF NOT EXISTS ix_task_assignments_recommendation_id ON task_assignments(recommendation_id);
CREATE INDEX IF NOT EXISTS ix_task_assignments_assigned_by_user_id ON task_assignments(assigned_by_user_id);
CREATE INDEX IF NOT EXISTS ix_task_assignments_schedule_version_id ON task_assignments(schedule_version_id);
CREATE INDEX IF NOT EXISTS ix_task_assignments_simulation_run_id ON task_assignments(simulation_run_id);
CREATE INDEX IF NOT EXISTS ix_task_dependencies_task_id ON task_dependencies(task_id);
CREATE INDEX IF NOT EXISTS ix_task_dependencies_depends_on_task_id ON task_dependencies(depends_on_task_id);
CREATE INDEX IF NOT EXISTS ix_task_requirements_task_id ON task_requirements(task_id);
CREATE INDEX IF NOT EXISTS ix_task_requirements_reviewed_by_user_id ON task_requirements(reviewed_by_user_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_users_username ON users(username);

-- Phase 2: time-series lookups (one astronaut, one measurement, a time range).
CREATE INDEX IF NOT EXISTS ix_sensor_readings_series ON sensor_readings(astronaut_id, measurement_type, timestamp_utc);
CREATE INDEX IF NOT EXISTS ix_environment_readings_series ON environment_readings(mission_id, measurement_type, timestamp_utc);
CREATE INDEX IF NOT EXISTS ix_radiation_readings_series ON radiation_readings(astronaut_id, timestamp_utc);
CREATE INDEX IF NOT EXISTS ix_sleep_records_series ON sleep_records(astronaut_id, sleep_start);
CREATE INDEX IF NOT EXISTS ix_activity_records_series ON activity_records(astronaut_id, start_time);

-- ---------------------------------------------------------------------------
-- Backend runtime tables (not seeded from CSV). They hold state the 49 CSVs
-- have no column for, so the seed tables stay identical to the source files.
-- ---------------------------------------------------------------------------

-- One row per import attempt: what was checked, what was written, any errors.
CREATE TABLE IF NOT EXISTS import_runs (
    import_run_id TEXT PRIMARY KEY NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    seed_dir TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'refused', 'failed')),
    rows_inserted INTEGER NOT NULL DEFAULT 0,
    rows_already_present INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    warning_count INTEGER NOT NULL DEFAULT 0,
    report_json TEXT NOT NULL DEFAULT '{}'
);

-- Login sessions. Only a SHA-256 of the bearer token is stored.
CREATE TABLE IF NOT EXISTS auth_sessions (
    session_id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(user_id)
);
CREATE INDEX IF NOT EXISTS ix_auth_sessions_user_id ON auth_sessions(user_id);

-- Wall-clock anchor for a running simulation. While a run is 'running',
-- mission time = current_mission_time + (now - anchor_wall_utc) * speed_multiplier.
-- Pausing folds the elapsed time into simulation_runs.current_mission_time.
CREATE TABLE IF NOT EXISTS simulation_run_clock (
    simulation_run_id TEXT PRIMARY KEY NOT NULL,
    anchor_wall_utc TEXT NOT NULL,
    FOREIGN KEY (simulation_run_id) REFERENCES simulation_runs(simulation_run_id) ON DELETE CASCADE
);
