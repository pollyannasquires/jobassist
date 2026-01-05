--
-- PostgreSQL database dump
--

\restrict WfG5ADiZHOv3lxTg3Dw4X3SGtaGlbcmVAgyM4C3nq8jiP2XfV0zoW0SUcCjOpuj

-- Dumped from database version 16.11 (Ubuntu 16.11-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.11 (Ubuntu 16.11-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

ALTER TABLE ONLY public.job_documents DROP CONSTRAINT job_documents_application_id_fkey;
ALTER TABLE ONLY public.company_name_mapping DROP CONSTRAINT fk_mapping_company_id;
ALTER TABLE ONLY public.job_documents DROP CONSTRAINT fk_document_application_id;
ALTER TABLE ONLY public.applications DROP CONSTRAINT fk_application_user_id;
ALTER TABLE ONLY public.applications DROP CONSTRAINT fk_application_job_title_id;
ALTER TABLE ONLY public.applications DROP CONSTRAINT fk_application_company_id;
ALTER TABLE ONLY public.company_name_mapping DROP CONSTRAINT company_name_mapping_company_id_fkey;
ALTER TABLE ONLY public.applications DROP CONSTRAINT applications_job_title_id_fkey;
ALTER TABLE ONLY public.applications DROP CONSTRAINT applications_company_id_fkey;
DROP TRIGGER set_job_titles_timestamp ON public.job_titles;
DROP TRIGGER set_applications_timestamp ON public.applications;
DROP INDEX public.idx_job_titles_standardized;
DROP INDEX public.idx_job_documents_application;
DROP INDEX public.idx_applications_user_company;
DROP INDEX public.idx_applications_status;
ALTER TABLE ONLY public.users DROP CONSTRAINT users_pkey;
ALTER TABLE ONLY public.users DROP CONSTRAINT users_email_key;
ALTER TABLE ONLY public.job_titles DROP CONSTRAINT job_titles_title_name_key;
ALTER TABLE ONLY public.job_titles DROP CONSTRAINT job_titles_pkey;
ALTER TABLE ONLY public.job_documents DROP CONSTRAINT job_documents_pkey;
ALTER TABLE ONLY public.job_documents DROP CONSTRAINT job_documents_file_path_key;
ALTER TABLE ONLY public.contacts DROP CONSTRAINT contacts_pkey;
ALTER TABLE ONLY public.contacts DROP CONSTRAINT contacts_email_address_key;
ALTER TABLE ONLY public.company_name_mapping DROP CONSTRAINT company_name_mapping_pkey;
ALTER TABLE ONLY public.companies DROP CONSTRAINT companies_pkey;
ALTER TABLE ONLY public.companies DROP CONSTRAINT companies_company_name_clean_key;
ALTER TABLE ONLY public.applications DROP CONSTRAINT applications_pkey;
ALTER TABLE public.job_titles ALTER COLUMN job_title_id DROP DEFAULT;
ALTER TABLE public.contacts ALTER COLUMN id DROP DEFAULT;
ALTER TABLE public.companies ALTER COLUMN company_id DROP DEFAULT;
DROP TABLE public.users;
DROP SEQUENCE public.job_titles_job_title_id_seq;
DROP TABLE public.job_titles;
DROP TABLE public.job_documents;
DROP SEQUENCE public.contacts_id_seq;
DROP TABLE public.contacts;
DROP TABLE public.company_name_mapping;
DROP SEQUENCE public.companies_company_id_seq;
DROP TABLE public.companies;
DROP TABLE public.applications;
DROP FUNCTION public.trigger_set_timestamp();
DROP TYPE public.document_type_enum;
--
-- Name: document_type_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.document_type_enum AS ENUM (
    'JOB_DESCRIPTION',
    'RESUME',
    'COVER_LETTER',
    'ASSESSMENT_FORM',
    'OTHER'
);


--
-- Name: trigger_set_timestamp(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trigger_set_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: applications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.applications (
    application_id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id integer NOT NULL,
    job_title_id bigint NOT NULL,
    user_id uuid NOT NULL,
    date_applied date NOT NULL,
    current_status character varying(50) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE applications; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.applications IS 'The core record for a single job application, linking a user, company, and job title.';


--
-- Name: companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.companies (
    company_id integer NOT NULL,
    company_name_clean character varying(100) NOT NULL,
    target_interest boolean DEFAULT false,
    size_employees integer,
    annual_revenue numeric(15,2),
    headquarters character varying(100),
    notes text,
    revenue_scale character varying(10)
);


--
-- Name: companies_company_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.companies_company_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: companies_company_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.companies_company_id_seq OWNED BY public.companies.company_id;


--
-- Name: company_name_mapping; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_name_mapping (
    raw_name character varying(100) NOT NULL,
    company_id integer
);


--
-- Name: contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contacts (
    id integer NOT NULL,
    first_name character varying(50),
    last_name character varying(50),
    url character varying(255),
    email_address character varying(100),
    company character varying(100),
    "position" character varying(100),
    connected_on date
);


--
-- Name: contacts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contacts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contacts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contacts_id_seq OWNED BY public.contacts.id;


--
-- Name: job_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_documents (
    document_id uuid DEFAULT gen_random_uuid() NOT NULL,
    application_id uuid NOT NULL,
    document_type public.document_type_enum NOT NULL,
    file_path character varying(512) NOT NULL,
    original_filename character varying(255) NOT NULL,
    mime_type character varying(100) NOT NULL,
    upload_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_file_path_not_empty CHECK (((file_path)::text <> ''::text))
);


--
-- Name: TABLE job_documents; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.job_documents IS 'Metadata store for documents uploaded for a specific job application.';


--
-- Name: job_titles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_titles (
    job_title_id bigint NOT NULL,
    title_name character varying(255) NOT NULL,
    standardized_title character varying(255),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE job_titles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.job_titles IS 'A lookup table for all unique job titles applied to, facilitating future analysis and standardization.';


--
-- Name: job_titles_job_title_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.job_titles_job_title_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: job_titles_job_title_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.job_titles_job_title_id_seq OWNED BY public.job_titles.job_title_id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    user_id uuid NOT NULL,
    email character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: companies company_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies ALTER COLUMN company_id SET DEFAULT nextval('public.companies_company_id_seq'::regclass);


--
-- Name: contacts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts ALTER COLUMN id SET DEFAULT nextval('public.contacts_id_seq'::regclass);


--
-- Name: job_titles job_title_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_titles ALTER COLUMN job_title_id SET DEFAULT nextval('public.job_titles_job_title_id_seq'::regclass);


--
-- Name: applications applications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_pkey PRIMARY KEY (application_id);


--
-- Name: companies companies_company_name_clean_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_company_name_clean_key UNIQUE (company_name_clean);


--
-- Name: companies companies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_pkey PRIMARY KEY (company_id);


--
-- Name: company_name_mapping company_name_mapping_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_name_mapping
    ADD CONSTRAINT company_name_mapping_pkey PRIMARY KEY (raw_name);


--
-- Name: contacts contacts_email_address_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_email_address_key UNIQUE (email_address);


--
-- Name: contacts contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_pkey PRIMARY KEY (id);


--
-- Name: job_documents job_documents_file_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_documents
    ADD CONSTRAINT job_documents_file_path_key UNIQUE (file_path);


--
-- Name: job_documents job_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_documents
    ADD CONSTRAINT job_documents_pkey PRIMARY KEY (document_id);


--
-- Name: job_titles job_titles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_titles
    ADD CONSTRAINT job_titles_pkey PRIMARY KEY (job_title_id);


--
-- Name: job_titles job_titles_title_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_titles
    ADD CONSTRAINT job_titles_title_name_key UNIQUE (title_name);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (user_id);


--
-- Name: idx_applications_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_applications_status ON public.applications USING btree (current_status);


--
-- Name: idx_applications_user_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_applications_user_company ON public.applications USING btree (user_id, company_id);


--
-- Name: idx_job_documents_application; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_documents_application ON public.job_documents USING btree (application_id);


--
-- Name: idx_job_titles_standardized; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_titles_standardized ON public.job_titles USING btree (standardized_title);


--
-- Name: applications set_applications_timestamp; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_applications_timestamp BEFORE UPDATE ON public.applications FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();


--
-- Name: job_titles set_job_titles_timestamp; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_job_titles_timestamp BEFORE UPDATE ON public.job_titles FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();


--
-- Name: applications applications_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE RESTRICT;


--
-- Name: applications applications_job_title_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_job_title_id_fkey FOREIGN KEY (job_title_id) REFERENCES public.job_titles(job_title_id) ON DELETE RESTRICT;


--
-- Name: company_name_mapping company_name_mapping_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_name_mapping
    ADD CONSTRAINT company_name_mapping_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id);


--
-- Name: applications fk_application_company_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT fk_application_company_id FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE RESTRICT;


--
-- Name: applications fk_application_job_title_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT fk_application_job_title_id FOREIGN KEY (job_title_id) REFERENCES public.job_titles(job_title_id) ON DELETE RESTRICT;


--
-- Name: applications fk_application_user_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT fk_application_user_id FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE RESTRICT;


--
-- Name: job_documents fk_document_application_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_documents
    ADD CONSTRAINT fk_document_application_id FOREIGN KEY (application_id) REFERENCES public.applications(application_id) ON DELETE CASCADE;


--
-- Name: company_name_mapping fk_mapping_company_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_name_mapping
    ADD CONSTRAINT fk_mapping_company_id FOREIGN KEY (company_id) REFERENCES public.companies(company_id);


--
-- Name: job_documents job_documents_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_documents
    ADD CONSTRAINT job_documents_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(application_id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict WfG5ADiZHOv3lxTg3Dw4X3SGtaGlbcmVAgyM4C3nq8jiP2XfV0zoW0SUcCjOpuj

