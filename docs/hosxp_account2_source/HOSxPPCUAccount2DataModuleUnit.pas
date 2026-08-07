unit HOSxPPCUAccount2DataModuleUnit;

interface

uses
  SysUtils, Classes, DB, DBClient;

{$RTTI EXPLICIT METHODS(DefaultMethodRttiVisibility) FIELDS(DefaultFieldRttiVisibility) PROPERTIES(DefaultPropertyRttiVisibility)}
type
  THOSxPPCUAccount2DataModule = class(TDataModule)
    LaborStatusCDS: TClientDataSet;
    LaborStatusDS: TDataSource;
    ANCBabyPositionDS: TDataSource;
    ANCBabyPositionCDs: TClientDataSet;
    ANCBabyLeadCDS: TClientDataSet;
    ANCBabyLeadDS: TDataSource;
    ANCServiceTypeCDS: TClientDataSet;
    ANCServiceTypeDS: TDataSource;
    ANCLocationTypeCDS: TClientDataSet;
    ANCLocationTypeDS: TDataSource;
    HospcodeCDS: TClientDataSet;
    HospcodeDS: TDataSource;
    LabourPlaceDS: TDataSource;
    LabourPlaceCDS: TClientDataSet;
    LabourDoctorTypeDS: TDataSource;
    LabourDoctortypeCDS: TClientDataSet;
    LabourTypeCDS: TClientDataSet;
    LabourTypeDS: TDataSource;
    DoctorCDS: TClientDataSet;
    DoctorDS: TDataSource;
    ANCPregCareLocationCDS: TClientDataSet;
    ANCPregCareLocationDS: TDataSource;
    ThalassemiaResultCDS: TClientDataSet;
    ThalassemiaResultDS: TDataSource;
    LookupNormalCDS: TClientDataSet;
    LookupNormalDS: TDataSource;
    ThalassaemiaRiskTypeCDS: TClientDataSet;
    ThalassaemiaRiskTypeDS: TDataSource;
    ThalassaemiaLocationTypeCDS: TClientDataSet;
    ThalassaemiaLocationTypeDS: TDataSource;
    ANCVcResultCDS: TClientDataSet;
    ANCVcResultDS: TDataSource;
    ANCServiceCDS: TClientDataSet;
    ANCServiceDS: TDataSource;
    ANCLabCDS: TClientDataSet;
    ANCLabDS: TDataSource;
    ANCUterusLevelCDS: TClientDataSet;
    ANCUterusLevelDS: TDataSource;
    ActiveDoctorCDS: TClientDataSet;
    ActiveDoctorDS: TDataSource;
    procedure DataModuleCreate(Sender: TObject);
  private
    { Private declarations }
  public
    { Public declarations }
  end;

var
  HOSxPPCUAccount2DataModule: THOSxPPCUAccount2DataModule;

implementation
uses HOSxPDMU,BMSApplicationUtil;

{$R *.dfm}

procedure THOSxPPCUAccount2DataModule.DataModuleCreate(Sender: TObject);
begin
  laborstatuscds.data := hosxp_getdataset_cache('select * from labor_status',laborstatuscds);
  ANCBabyPositionCDs.Data:=hosxp_getdataset_cache('select * from anc_baby_position',ANCBabyPositionCDs);
  ANCBabyLeadCDS.Data:=hosxp_getdataset_cache('select * from anc_baby_lead',ANCBabyLeadCDS);
  ANCServiceTypeCDS.Data:=hosxp_getdataset_cache('select * from anc_service_type  where anc_service_type_id = 1',ANCServiceTypeCDS);
  ANCLocationTypeCDS.Data:=hosxp_getdataset_cache('select * from anc_location_type',ANCLocationTypeCDS);
   hospcodecds.data :=
    hosxp_getdataset_cache('select hospcode,concat(hospcode,":",hosptype,name) as hospname from hospcode order by hospcode',hospcodecds);
    labourplacecds.data := hosxp_getdataset_cache('select * from person_labour_place',labourplacecds);
    labourdoctortypecds.data :=
    hosxp_getdataset_cache('select * from person_labour_doctor_type',labourdoctortypecds);
    labourtypecds.data := hosxp_getdataset_cache('select * from person_labour_type',labourtypecds);
    DoctorCDS.Data:=hosxp_getdataset_cache('select code,name from doctor order by name',doctorcds);
    ActiveDoctorCDS.Data:=hosxp_getdataset_cache('select code,name from doctor where active="Y" order by name',activedoctorcds);

    ANCPregCareLocationCDS.Data:=hosxp_getdataset_cache('select * from anc_preg_care_location',ANCPregCareLocationCDS);

    ThalassemiaResultCDS.data :=
    hosxp_getdataset_cache('select * from thalassaemia_result',ThalassemiaResultCDS);
     ThalassaemiaRiskTypeCDS.data:=hosxp_getdataset_cache('select * from thalassaemia_risk_type',ThalassaemiaRiskTypeCDS);
      ThalassaemiaLocationTypeCDS.data :=
    hosxp_getdataset_cache('select * from  thalassaemia_location_type',ThalassaemiaLocationTypeCDS);
    ancvcresultcds.data := hosxp_getdataset_cache('select * from anc_vc_result',ancvcresultcds);

    ANCServiceCDS.Data:=hosxp_getdataset_cache('select * from anc_service',ANCServiceCDS);

    ANCLabCDS.Data:=hosxp_getdataset_cache('select * from anc_lab',ANCLabCDS);
    ANCUterusLevelCDS.Data:=hosxp_getdataset_cache('select * from anc_uterus_level order by anc_uterus_level_id',ANCUterusLevelCDS);
end;

end.
